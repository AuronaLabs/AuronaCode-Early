use arc_swap::ArcSwap;
use dashmap::DashMap;
use regex::Regex;
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{BufReader, BufWriter, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::State;

const MAX_EDITOR_FILE_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone)]
pub struct DocumentSnapshot {
    pub version: u64,
    pub content: Rope,
}

#[derive(Clone)]
struct BatchReceipt {
    id: String,
    response: ApplyEditsResponse,
}

pub struct EditorSession {
    pub language: String,
    pub line_ending: String,
    pub write_lock: Mutex<()>,
    pub snapshot: ArcSwap<DocumentSnapshot>,
    pub line_states: Mutex<Vec<LexerState>>,
    pub saved_revision: AtomicU64,
    pub disk_fingerprint: Mutex<String>,
    recent_batches: Mutex<VecDeque<BatchReceipt>>,
}

impl EditorSession {
    pub fn new(
        language: String,
        line_ending: String,
        rope: Rope,
        disk_fingerprint: String,
    ) -> Self {
        let total_lines = rope.len_lines();
        Self {
            language,
            line_ending,
            write_lock: Mutex::new(()),
            snapshot: ArcSwap::new(Arc::new(DocumentSnapshot {
                version: 0,
                content: rope,
            })),
            line_states: Mutex::new(vec![LexerState::Normal; total_lines]),
            saved_revision: AtomicU64::new(0),
            disk_fingerprint: Mutex::new(disk_fingerprint),
            recent_batches: Mutex::new(VecDeque::new()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopError {
    pub domain: String,
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<String>,
}

impl DesktopError {
    fn editor(code: &str, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            domain: "editor".to_string(),
            code: code.to_string(),
            message: message.into(),
            recoverable,
            cause: None,
        }
    }

    fn io(code: &str, message: impl Into<String>, cause: impl ToString) -> Self {
        Self {
            domain: "filesystem".to_string(),
            code: code.to_string(),
            message: message.into(),
            recoverable: true,
            cause: Some(cause.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEdit {
    pub start_utf16: usize,
    pub end_utf16: usize,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyEditsRequest {
    pub path: String,
    pub base_revision: u64,
    pub client_batch_id: String,
    pub edits: Vec<TextEdit>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyEditsResponse {
    pub revision: u64,
    pub line_count: usize,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSnapshotResponse {
    pub path: String,
    pub revision: u64,
    pub saved_revision: u64,
    pub text: String,
    pub line_ending: String,
    pub language: String,
    pub line_count: usize,
    pub disk_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorLinesResponse {
    pub revision: u64,
    pub start_line: usize,
    pub lines: Vec<LineRenderData>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEditorRequest {
    pub path: String,
    pub expected_revision: u64,
    pub disk_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEditorResponse {
    pub revision: u64,
    pub disk_fingerprint: String,
}

pub struct EditorState {
    pub sessions: DashMap<String, Arc<EditorSession>>,
}

impl EditorState {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }
}

// ── UTF-16 <-> Rope Char Index 转换器 ──────────────────────────────────────
fn utf16_to_char_idx_strict(rope: &Rope, utf16_idx: usize) -> Result<usize, DesktopError> {
    if utf16_idx == 0 {
        return Ok(0);
    }

    let mut current_utf16 = 0;
    let mut current_char = 0;
    for chunk in rope.chunks() {
        for character in chunk.chars() {
            if current_utf16 == utf16_idx {
                return Ok(current_char);
            }
            let width = character.len_utf16();
            if current_utf16 + width > utf16_idx {
                return Err(DesktopError::editor(
                    "invalid_utf16_boundary",
                    "编辑位置落在 UTF-16 代理对中间",
                    false,
                ));
            }
            current_utf16 += width;
            current_char += 1;
        }
    }

    if current_utf16 == utf16_idx {
        Ok(current_char)
    } else {
        Err(DesktopError::editor(
            "edit_range_out_of_bounds",
            "编辑位置超出文档范围",
            false,
        ))
    }
}

fn normalize_path(path: &str) -> String {
    Path::new(path)
        .canonicalize()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string())
}

fn fingerprint_bytes(bytes: &[u8]) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}:{}", hasher.finish(), bytes.len())
}

fn fingerprint_file(path: &Path) -> Result<String, DesktopError> {
    let bytes = std::fs::read(path)
        .map_err(|error| DesktopError::io("fingerprint_failed", "无法读取磁盘文件", error))?;
    Ok(fingerprint_bytes(&bytes))
}

fn recover_interrupted_save(path: &Path) -> Result<(), DesktopError> {
    let path_string = path.to_string_lossy();
    let temp_path = std::path::PathBuf::from(format!("{path_string}.aurona_save.tmp"));
    let backup_path = std::path::PathBuf::from(format!("{path_string}.aurona_save.bak"));

    if !path.exists() {
        let recovery_source = if temp_path.exists() {
            Some(&temp_path)
        } else if backup_path.exists() {
            Some(&backup_path)
        } else {
            None
        };
        if let Some(source) = recovery_source {
            std::fs::rename(source, path).map_err(|error| {
                DesktopError::io("save_recovery_failed", "无法恢复中断的保存文件", error)
            })?;
        }
    }

    if path.exists() {
        let _ = std::fs::remove_file(temp_path);
        let _ = std::fs::remove_file(backup_path);
    }
    Ok(())
}

// ── 状态机定义与词法着色引擎 ────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum LexerState {
    Normal,
    InDocStringDouble, // Python """
    InDocStringSingle, // Python '''
    InBlockComment,    // JS/Rust/CSS /* */
}

#[derive(Serialize, Debug, Clone)]
pub struct LineRenderData {
    pub text: String,
    pub tokens: Vec<u32>, // [start_utf16, len_utf16, token_type_id, ...]
}

struct TokenRule {
    token_type: u32,
    regex: Regex,
    capture_group: Option<usize>,
}

pub const TOKEN_KEYWORD: u32 = 1;
pub const TOKEN_STRING: u32 = 2;
pub const TOKEN_NUMBER: u32 = 3;
pub const TOKEN_FUNCTION: u32 = 4;
pub const TOKEN_SPECIAL_DECORATOR: u32 = 5;
pub const TOKEN_COMMENT: u32 = 6;
pub const TOKEN_OPERATOR: u32 = 7;
pub const TOKEN_BUILTIN: u32 = 8;
pub const TOKEN_TYPE_HINT: u32 = 9;

fn get_rules(lang: &str) -> &'static Vec<TokenRule> {
    static RUST_RULES: OnceLock<Vec<TokenRule>> = OnceLock::new();
    static JS_RULES: OnceLock<Vec<TokenRule>> = OnceLock::new();
    static PYTHON_RULES: OnceLock<Vec<TokenRule>> = OnceLock::new();
    static JSON_RULES: OnceLock<Vec<TokenRule>> = OnceLock::new();
    static CSS_RULES: OnceLock<Vec<TokenRule>> = OnceLock::new();
    static HTML_RULES: OnceLock<Vec<TokenRule>> = OnceLock::new();
    static DEFAULT_RULES: OnceLock<Vec<TokenRule>> = OnceLock::new();

    match lang.to_lowercase().as_str() {
        "rust" | "rs" => RUST_RULES.get_or_init(|| {
            vec![
                TokenRule { token_type: TOKEN_COMMENT, regex: Regex::new(r"^//.*").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^"([^"\\]|\\.)*""#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^'([^'\\]|\\.)*'"#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_KEYWORD, regex: Regex::new(r"^(?:fn|let|mut|const|struct|enum|impl|use|mod|pub|return|if|else|match|for|while|loop|in|as|trait|type|crate|self|Self|async|await)\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_FUNCTION, regex: Regex::new(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(").unwrap(), capture_group: Some(1) },
                TokenRule { token_type: TOKEN_FUNCTION, regex: Regex::new(r"^([a-zA-Z_][a-zA-Z0-9_]*!)\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_NUMBER, regex: Regex::new(r"^\b\d+(\.\d+)?\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_OPERATOR, regex: Regex::new(r"^[-+*/%=<>!&|^~]").unwrap(), capture_group: None },
            ]
        }),
        "javascript" | "typescript" | "js" | "ts" | "jsx" | "tsx" => JS_RULES.get_or_init(|| {
            vec![
                TokenRule { token_type: TOKEN_COMMENT, regex: Regex::new(r"^//.*").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^"([^"\\]|\\.)*""#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^'([^'\\]|\\.)*'"#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^`([^`\\]|\\.)*`"#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_KEYWORD, regex: Regex::new(r"^(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|new|import|export|from|default|as|async|await|try|catch|finally|throw|typeof|instanceof|in|of|null|undefined|true|false)\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_FUNCTION, regex: Regex::new(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(").unwrap(), capture_group: Some(1) },
                TokenRule { token_type: TOKEN_NUMBER, regex: Regex::new(r"^\b\d+(\.\d+)?\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_OPERATOR, regex: Regex::new(r"^[-+*/%=<>!&|^~]").unwrap(), capture_group: None },
            ]
        }),
        "python" | "py" => PYTHON_RULES.get_or_init(|| {
            vec![
                TokenRule { token_type: TOKEN_COMMENT, regex: Regex::new(r"^#.*").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new("(?is)^[rfb]*\"\"\".*?\"\"\"").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r"(?is)^[rfb]*'''.*?'''").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"(?i)^[rfb]*"([^"\\]|\\.)*""#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"(?i)^[rfb]*'([^'\\]|\\.)*'"#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_KEYWORD, regex: Regex::new(r"^(?:def|class|import|from|as|if|else|elif|for|while|return|in|is|not|and|or|try|except|finally|raise|with|lambda|global|nonlocal|pass|break|continue|None|True|False|async|await|yield|del|assert|match|case)\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_BUILTIN, regex: Regex::new(r"^(?:print|len|range|str|int|float|list|dict|set|tuple|enumerate|zip|min|max|sum|any|all|map|filter|super|Exception|ValueError|TypeError|KeyError|IndexError|abs|bool|chr|dir|eval|exec|hash|hex|id|isinstance|issubclass|iter|next|oct|open|ord|pow|repr|reversed|round|sorted|type)\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_FUNCTION, regex: Regex::new(r"^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\b").unwrap(), capture_group: Some(1) },
                TokenRule { token_type: TOKEN_TYPE_HINT, regex: Regex::new(r"^class\s+([a-zA-Z_][a-zA-Z0-9_]*)\b").unwrap(), capture_group: Some(1) },
                TokenRule { token_type: TOKEN_SPECIAL_DECORATOR, regex: Regex::new(r"^@[a-zA-Z_][a-zA-Z0-9_]*").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_SPECIAL_DECORATOR, regex: Regex::new(r"^__[a-zA-Z0-9_]+__\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_FUNCTION, regex: Regex::new(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(").unwrap(), capture_group: Some(1) },
                TokenRule { token_type: TOKEN_NUMBER, regex: Regex::new(r"^0[xX][0-9a-fA-F_]+").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_NUMBER, regex: Regex::new(r"^0[oO][0-7_]+").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_NUMBER, regex: Regex::new(r"^0[bB][01_]+").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_NUMBER, regex: Regex::new(r"^\d[0-9_]*(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?[jJ]?\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_OPERATOR, regex: Regex::new(r"^(?:\*\*|//|:=|[-+*/%<>!=&|^~])").unwrap(), capture_group: None },
            ]
        }),
        "json" => JSON_RULES.get_or_init(|| {
            vec![
                TokenRule { token_type: TOKEN_SPECIAL_DECORATOR, regex: Regex::new(r#"^("(?:[^"\\]|\\.)*")\s*:"#).unwrap(), capture_group: Some(1) },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^"([^"\\]|\\.)*""#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_NUMBER, regex: Regex::new(r"^\b\d+(\.\d+)?\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_KEYWORD, regex: Regex::new(r"^\b(true|false|null)\b").unwrap(), capture_group: None },
            ]
        }),
        "css" => CSS_RULES.get_or_init(|| {
            vec![
                TokenRule { token_type: TOKEN_KEYWORD, regex: Regex::new(r"^(\.[a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+)").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_SPECIAL_DECORATOR, regex: Regex::new(r"^([a-zA-Z_-][a-zA-Z0-9_-]*)\s*:").unwrap(), capture_group: Some(1) },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^("[^"]*"|'[^']*')"#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_NUMBER, regex: Regex::new(r"^\b\d+(px|em|rem|%|ms|s)?\b").unwrap(), capture_group: None },
            ]
        }),
        "html" | "xml" => HTML_RULES.get_or_init(|| {
            vec![
                TokenRule { token_type: TOKEN_KEYWORD, regex: Regex::new(r"^<[a-zA-Z0-9_-]+|^/[a-zA-Z0-9_-]+>").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_SPECIAL_DECORATOR, regex: Regex::new(r"^\b[a-zA-Z0-9_-]+=").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^("[^"]*"|'[^']*')"#).unwrap(), capture_group: None },
            ]
        }),
        _ => DEFAULT_RULES.get_or_init(Vec::new),
    }
}

fn python_triple_string_is_unclosed(text: &str, delimiter: &str) -> bool {
    let prefix_length = text
        .chars()
        .take_while(|character| matches!(character.to_ascii_lowercase(), 'r' | 'f' | 'b'))
        .map(char::len_utf8)
        .sum::<usize>();
    let Some(body) = text.get(prefix_length..) else {
        return false;
    };
    body.strip_prefix(delimiter)
        .is_some_and(|remainder| !remainder.contains(delimiter))
}

pub fn highlight_line_stateful(
    text: &str,
    language: &str,
    initial_state: LexerState,
) -> (Vec<u32>, LexerState) {
    let rules = get_rules(language);
    let mut tokens = Vec::new();
    let mut current_state = initial_state;
    let mut i = 0;
    let byte_len = text.len();

    let char_indices: Vec<(usize, char)> = text.char_indices().collect();
    let get_utf16_idx = |byte_idx: usize| -> u32 {
        let mut utf16_idx = 0;
        for &(b_idx, c) in &char_indices {
            if b_idx >= byte_idx {
                return utf16_idx;
            }
            utf16_idx += if (c as u32) > 0xFFFF { 2 } else { 1 };
        }
        utf16_idx
    };

    while i < byte_len {
        let remaining = &text[i..];

        match current_state {
            LexerState::InDocStringDouble => {
                if let Some(end) = remaining.find("\"\"\"").map(|index| index + 3) {
                    let start_utf16 = get_utf16_idx(i);
                    let len_utf16 = get_utf16_idx(i + end) - start_utf16;
                    tokens.push(start_utf16);
                    tokens.push(len_utf16);
                    tokens.push(TOKEN_STRING);

                    i += end;
                    current_state = LexerState::Normal;
                } else {
                    let start_utf16 = get_utf16_idx(i);
                    let len_utf16 = get_utf16_idx(byte_len) - start_utf16;
                    tokens.push(start_utf16);
                    tokens.push(len_utf16);
                    tokens.push(TOKEN_STRING);
                    i = byte_len;
                }
                continue;
            }
            LexerState::InDocStringSingle => {
                if let Some(end) = remaining.find("'''").map(|index| index + 3) {
                    let start_utf16 = get_utf16_idx(i);
                    let len_utf16 = get_utf16_idx(i + end) - start_utf16;
                    tokens.push(start_utf16);
                    tokens.push(len_utf16);
                    tokens.push(TOKEN_STRING);

                    i += end;
                    current_state = LexerState::Normal;
                } else {
                    let start_utf16 = get_utf16_idx(i);
                    let len_utf16 = get_utf16_idx(byte_len) - start_utf16;
                    tokens.push(start_utf16);
                    tokens.push(len_utf16);
                    tokens.push(TOKEN_STRING);
                    i = byte_len;
                }
                continue;
            }
            LexerState::InBlockComment => {
                if let Some(end) = remaining.find("*/").map(|index| index + 2) {
                    let start_utf16 = get_utf16_idx(i);
                    let len_utf16 = get_utf16_idx(i + end) - start_utf16;
                    tokens.push(start_utf16);
                    tokens.push(len_utf16);
                    tokens.push(TOKEN_COMMENT);

                    i += end;
                    current_state = LexerState::Normal;
                } else {
                    let start_utf16 = get_utf16_idx(i);
                    let len_utf16 = get_utf16_idx(byte_len) - start_utf16;
                    tokens.push(start_utf16);
                    tokens.push(len_utf16);
                    tokens.push(TOKEN_COMMENT);
                    i = byte_len;
                }
                continue;
            }
            LexerState::Normal => {}
        }

        if language == "python" || language == "py" {
            if python_triple_string_is_unclosed(remaining, "\"\"\"") {
                let start_utf16 = get_utf16_idx(i);
                let len_utf16 = get_utf16_idx(byte_len) - start_utf16;
                tokens.push(start_utf16);
                tokens.push(len_utf16);
                tokens.push(TOKEN_STRING);
                current_state = LexerState::InDocStringDouble;
                break;
            }

            if python_triple_string_is_unclosed(remaining, "'''") {
                let start_utf16 = get_utf16_idx(i);
                let len_utf16 = get_utf16_idx(byte_len) - start_utf16;
                tokens.push(start_utf16);
                tokens.push(len_utf16);
                tokens.push(TOKEN_STRING);
                current_state = LexerState::InDocStringSingle;
                break;
            }
        } else if matches!(
            language,
            "javascript" | "typescript" | "js" | "ts" | "rust" | "rs" | "css"
        ) && remaining.starts_with("/*")
            && !remaining[2..].contains("*/")
        {
            let start_utf16 = get_utf16_idx(i);
            let len_utf16 = get_utf16_idx(byte_len) - start_utf16;
            tokens.push(start_utf16);
            tokens.push(len_utf16);
            tokens.push(TOKEN_COMMENT);
            current_state = LexerState::InBlockComment;
            break;
        }

        let mut matched = false;
        for rule in rules {
            if let Some(captures) = rule.regex.captures(remaining) {
                let mat = match rule.capture_group {
                    Some(g_idx) => captures.get(g_idx),
                    None => captures.get(0),
                };

                if let Some(m) = mat {
                    if m.start() == 0 {
                        let start_byte = i + m.start();
                        let end_byte = i + m.end();
                        let start_utf16 = get_utf16_idx(start_byte);
                        let len_utf16 = get_utf16_idx(end_byte) - start_utf16;

                        tokens.push(start_utf16);
                        tokens.push(len_utf16);
                        tokens.push(rule.token_type);

                        let full_match = captures.get(0).unwrap();
                        i += full_match.end();
                        matched = true;
                        break;
                    }
                }
            }
        }

        if !matched {
            let first_char = remaining.chars().next().unwrap();
            i += first_char.len_utf8();
        }
    }

    (tokens, current_state)
}

fn detect_language(path: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "rs" => "rust".to_string(),
        "js" | "jsx" => "javascript".to_string(),
        "ts" | "tsx" => "typescript".to_string(),
        "py" => "python".to_string(),
        "json" => "json".to_string(),
        "css" => "css".to_string(),
        "html" | "htm" => "html".to_string(),
        _ => "text".to_string(),
    }
}

// ── Core Internal Helpers (带增量状态维护与传播) ───────────────────────

fn snapshot_response(
    normalized_path: &str,
    session: &EditorSession,
) -> Result<EditorSnapshotResponse, DesktopError> {
    let snapshot = session.snapshot.load();
    let fingerprint = session
        .disk_fingerprint
        .lock()
        .map_err(|_| DesktopError::editor("state_lock_failed", "无法读取磁盘指纹", true))?
        .clone();
    Ok(EditorSnapshotResponse {
        path: normalized_path.to_string(),
        revision: snapshot.version,
        saved_revision: session.saved_revision.load(Ordering::Acquire),
        text: snapshot.content.to_string(),
        line_ending: if session.line_ending == "\r\n" {
            "crlf".to_string()
        } else {
            "lf".to_string()
        },
        language: session.language.clone(),
        line_count: snapshot.content.len_lines(),
        disk_fingerprint: fingerprint,
    })
}

pub fn open_file_internal(
    path: &str,
    state: &EditorState,
) -> Result<EditorSnapshotResponse, DesktopError> {
    let requested_path = Path::new(path);
    recover_interrupted_save(requested_path)?;
    let file_size = std::fs::metadata(requested_path)
        .map_err(|error| DesktopError::io("metadata_failed", "无法读取文件信息", error))?
        .len();
    if file_size > MAX_EDITOR_FILE_BYTES {
        return Err(DesktopError::editor(
            "file_too_large",
            format!(
                "文件大小为 {:.1} MiB，超过 Aurona Code 0.3.0 的 32 MiB 完整编辑上限",
                file_size as f64 / (1024.0 * 1024.0)
            ),
            false,
        ));
    }
    let normalized_path = normalize_path(path);

    if let Some(session) = state.sessions.get(&normalized_path) {
        return snapshot_response(&normalized_path, &session);
    }

    let language = detect_language(&normalized_path);
    let file = File::open(&normalized_path)
        .map_err(|error| DesktopError::io("open_failed", "无法打开文件", error))?;
    let source_rope = Rope::from_reader(BufReader::new(file))
        .map_err(|error| DesktopError::io("decode_failed", "无法解析 UTF-8 文本", error))?;
    let source_content = source_rope.to_string();
    let line_ending = if source_content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let content = source_content.replace("\r\n", "\n");
    let rope = Rope::from_str(&content);
    let fingerprint = fingerprint_file(Path::new(&normalized_path))?;
    let session = Arc::new(EditorSession::new(
        language,
        line_ending.to_string(),
        rope,
        fingerprint,
    ));
    let response = snapshot_response(&normalized_path, &session)?;
    state.sessions.insert(normalized_path, session);
    Ok(response)
}

pub fn get_lines_internal(
    path: &str,
    start_line: usize,
    end_line: usize,
    state: &EditorState,
) -> Result<EditorLinesResponse, DesktopError> {
    let normalized_path = normalize_path(path);
    let session = state.sessions.get(&normalized_path).ok_or_else(|| {
        DesktopError::editor(
            "session_not_found",
            format!("未找到该文件的编辑器会话: {normalized_path}"),
            true,
        )
    })?;

    let snapshot = session.snapshot.load();
    let rope = &snapshot.content;
    let total_lines = rope.len_lines();
    let actual_end = std::cmp::min(end_line.max(start_line), total_lines);
    let mut lines = Vec::with_capacity(actual_end.saturating_sub(start_line));
    if start_line >= total_lines {
        return Ok(EditorLinesResponse {
            revision: snapshot.version,
            start_line,
            lines,
        });
    }

    let mut states_guard = session
        .line_states
        .lock()
        .map_err(|_| DesktopError::editor("state_lock_failed", "无法读取高亮状态", true))?;
    if states_guard.len() != total_lines {
        states_guard.resize(total_lines, LexerState::Normal);
    }

    for index in start_line..actual_end {
        let mut line = rope.line(index).to_string();
        if line.ends_with('\n') {
            line.pop();
            if line.ends_with('\r') {
                line.pop();
            }
        } else if line.ends_with('\r') {
            line.pop();
        }
        let initial_state = if index == 0 {
            LexerState::Normal
        } else {
            states_guard[index - 1]
        };
        let (tokens, end_state) = highlight_line_stateful(&line, &session.language, initial_state);
        states_guard[index] = end_state;
        lines.push(LineRenderData { text: line, tokens });
    }

    Ok(EditorLinesResponse {
        revision: snapshot.version,
        start_line,
        lines,
    })
}

#[tauri::command]
pub fn open_editor_file(
    path: String,
    state: State<'_, EditorState>,
) -> Result<EditorSnapshotResponse, DesktopError> {
    open_file_internal(&path, &state)
}

fn apply_edits_internal(
    request: ApplyEditsRequest,
    session: &EditorSession,
) -> Result<ApplyEditsResponse, DesktopError> {
    let _guard = session
        .write_lock
        .lock()
        .map_err(|_| DesktopError::editor("write_lock_failed", "无法锁定文档", true))?;

    if request.client_batch_id.is_empty() {
        return Err(DesktopError::editor(
            "invalid_batch_id",
            "编辑批次缺少唯一标识",
            false,
        ));
    }
    if let Some(receipt) = session
        .recent_batches
        .lock()
        .map_err(|_| DesktopError::editor("state_lock_failed", "无法读取编辑批次", true))?
        .iter()
        .find(|receipt| receipt.id == request.client_batch_id)
        .cloned()
    {
        return Ok(receipt.response);
    }

    let old_snapshot = session.snapshot.load();
    if old_snapshot.version != request.base_revision {
        return Err(DesktopError::editor(
            "revision_conflict",
            format!(
                "文档版本已变化：期望 {}，当前 {}",
                request.base_revision, old_snapshot.version
            ),
            true,
        ));
    }
    if request.edits.is_empty() {
        return Ok(ApplyEditsResponse {
            revision: old_snapshot.version,
            line_count: old_snapshot.content.len_lines(),
            dirty: old_snapshot.version != session.saved_revision.load(Ordering::Acquire),
        });
    }

    let mut new_rope = old_snapshot.content.clone();
    let mut earliest_line = new_rope.len_lines();
    for edit in request.edits {
        let start_char = utf16_to_char_idx_strict(&new_rope, edit.start_utf16)?;
        let end_char = utf16_to_char_idx_strict(&new_rope, edit.end_utf16)?;
        if start_char > end_char {
            return Err(DesktopError::editor(
                "invalid_edit_range",
                "编辑起点不能位于终点之后",
                false,
            ));
        }
        earliest_line = earliest_line.min(new_rope.char_to_line(start_char));
        new_rope.remove(start_char..end_char);
        if !edit.text.is_empty() {
            new_rope.insert(start_char, &edit.text);
        }
    }

    let new_revision = old_snapshot.version + 1;
    let new_line_count = new_rope.len_lines();
    {
        let mut states = session
            .line_states
            .lock()
            .map_err(|_| DesktopError::editor("state_lock_failed", "无法更新高亮状态", true))?;
        states.resize(new_line_count, LexerState::Normal);
        for state in states.iter_mut().skip(earliest_line) {
            *state = LexerState::Normal;
        }
    }
    session.snapshot.store(Arc::new(DocumentSnapshot {
        version: new_revision,
        content: new_rope,
    }));
    let response = ApplyEditsResponse {
        revision: new_revision,
        line_count: new_line_count,
        dirty: new_revision != session.saved_revision.load(Ordering::Acquire),
    };
    let mut receipts = session
        .recent_batches
        .lock()
        .map_err(|_| DesktopError::editor("state_lock_failed", "无法记录编辑批次", true))?;
    receipts.push_back(BatchReceipt {
        id: request.client_batch_id,
        response: response.clone(),
    });
    while receipts.len() > 128 {
        receipts.pop_front();
    }
    Ok(response)
}

#[tauri::command]
pub fn apply_editor_edits(
    request: ApplyEditsRequest,
    state: State<'_, EditorState>,
) -> Result<ApplyEditsResponse, DesktopError> {
    let normalized_path = normalize_path(&request.path);
    let session = state.sessions.get(&normalized_path).ok_or_else(|| {
        DesktopError::editor(
            "session_not_found",
            format!("未找到该文件的编辑器会话: {normalized_path}"),
            true,
        )
    })?;
    apply_edits_internal(request, session.value())
}

#[tauri::command]
pub fn get_editor_lines(
    path: String,
    start_line: usize,
    end_line: usize,
    state: State<'_, EditorState>,
) -> Result<EditorLinesResponse, DesktopError> {
    get_lines_internal(&path, start_line, end_line, &state)
}

#[tauri::command]
pub fn save_editor_file(
    request: SaveEditorRequest,
    state: State<'_, EditorState>,
) -> Result<SaveEditorResponse, DesktopError> {
    let normalized_path = normalize_path(&request.path);
    let session = state.sessions.get(&normalized_path).ok_or_else(|| {
        DesktopError::editor(
            "session_not_found",
            format!("未找到该文件的编辑器会话: {normalized_path}"),
            true,
        )
    })?;
    let _guard = session
        .write_lock
        .lock()
        .map_err(|_| DesktopError::editor("write_lock_failed", "无法锁定文档", true))?;
    let snapshot = session.snapshot.load();
    if snapshot.version != request.expected_revision {
        return Err(DesktopError::editor(
            "revision_conflict",
            "保存前文档版本已变化",
            true,
        ));
    }

    let target_path = Path::new(&normalized_path);
    let current_fingerprint = fingerprint_file(target_path)?;
    let known_fingerprint = session
        .disk_fingerprint
        .lock()
        .map_err(|_| DesktopError::editor("state_lock_failed", "无法读取磁盘指纹", true))?
        .clone();
    if current_fingerprint != request.disk_fingerprint || current_fingerprint != known_fingerprint {
        return Err(DesktopError::editor(
            "external_modification",
            "文件已被其他程序修改，已阻止覆盖保存",
            true,
        ));
    }

    let temp_path = format!("{normalized_path}.aurona_save.tmp");
    let backup_path = format!("{normalized_path}.aurona_save.bak");
    let permissions = std::fs::metadata(target_path)
        .ok()
        .map(|metadata| metadata.permissions());
    {
        let file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| {
                DesktopError::io("temp_create_failed", "无法创建临时保存文件", error)
            })?;
        let mut writer = BufWriter::new(file);
        for chunk in snapshot.content.chunks() {
            let bytes = if session.line_ending == "\r\n" {
                chunk.replace('\n', "\r\n")
            } else {
                chunk.to_string()
            };
            writer
                .write_all(bytes.as_bytes())
                .map_err(|error| DesktopError::io("write_failed", "无法写入临时保存文件", error))?;
        }
        writer
            .flush()
            .map_err(|error| DesktopError::io("flush_failed", "无法刷新临时保存文件", error))?;
        writer
            .get_ref()
            .sync_all()
            .map_err(|error| DesktopError::io("sync_failed", "无法将临时文件同步到磁盘", error))?;
    }
    if let Some(permissions) = permissions {
        if let Err(error) = std::fs::set_permissions(&temp_path, permissions) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(DesktopError::io(
                "permission_copy_failed",
                "无法保留文件权限",
                error,
            ));
        }
    }

    let _ = std::fs::remove_file(&backup_path);
    std::fs::rename(&normalized_path, &backup_path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        DesktopError::io("replace_prepare_failed", "无法准备原子替换", error)
    })?;
    if let Err(error) = std::fs::rename(&temp_path, &normalized_path) {
        let _ = std::fs::rename(&backup_path, &normalized_path);
        let _ = std::fs::remove_file(&temp_path);
        return Err(DesktopError::io(
            "replace_failed",
            "无法替换原文件，原文件已尝试恢复",
            error,
        ));
    }
    File::open(&normalized_path)
        .and_then(|file| file.sync_all())
        .map_err(|error| DesktopError::io("final_sync_failed", "无法同步保存结果", error))?;
    let _ = std::fs::remove_file(&backup_path);

    let new_fingerprint = fingerprint_file(Path::new(&normalized_path))?;
    *session
        .disk_fingerprint
        .lock()
        .map_err(|_| DesktopError::editor("state_lock_failed", "无法更新磁盘指纹", true))? =
        new_fingerprint.clone();
    session
        .saved_revision
        .store(snapshot.version, Ordering::Release);
    Ok(SaveEditorResponse {
        revision: snapshot.version,
        disk_fingerprint: new_fingerprint,
    })
}

#[tauri::command]
pub fn close_editor_file(
    path: String,
    force: bool,
    state: State<'_, EditorState>,
) -> Result<(), DesktopError> {
    let normalized_path = normalize_path(&path);
    if let Some(session) = state.sessions.get(&normalized_path) {
        let revision = session.snapshot.load().version;
        if !force && revision != session.saved_revision.load(Ordering::Acquire) {
            return Err(DesktopError::editor(
                "document_dirty",
                "文档仍有未保存内容，不能关闭会话",
                true,
            ));
        }
    }
    state.sessions.remove(&normalized_path);
    Ok(())
}

// ── Unit Tests ────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_file(content: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("aurona-editor-{nonce}.txt"));
        std::fs::write(&path, content).expect("write fixture");
        path
    }

    #[test]
    fn batch_edits_are_atomic_and_increment_once() {
        let state = EditorState::new();
        let path = test_file("ab\ncd");
        let path_string = path.to_string_lossy().to_string();
        let opened = open_file_internal(&path_string, &state).expect("open");
        assert_eq!(opened.revision, 0);

        let session = state.sessions.get(&normalize_path(&path_string)).unwrap();
        let request = ApplyEditsRequest {
            path: path_string.clone(),
            base_revision: 0,
            client_batch_id: "batch-1".to_string(),
            edits: vec![
                TextEdit {
                    start_utf16: 1,
                    end_utf16: 1,
                    text: "X".to_string(),
                },
                TextEdit {
                    start_utf16: 4,
                    end_utf16: 5,
                    text: "Y".to_string(),
                },
            ],
        };
        let response = apply_edits_internal(request, session.value()).expect("apply");
        assert_eq!(response.revision, 1);
        assert_eq!(session.snapshot.load().content.to_string(), "aXb\nYd");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn invalid_later_edit_rolls_back_the_entire_batch() {
        let state = EditorState::new();
        let path = test_file("alpha");
        let path_string = path.to_string_lossy().to_string();
        open_file_internal(&path_string, &state).expect("open");
        let session = state.sessions.get(&normalize_path(&path_string)).unwrap();
        let request = ApplyEditsRequest {
            path: path_string.clone(),
            base_revision: 0,
            client_batch_id: "invalid-batch".to_string(),
            edits: vec![
                TextEdit {
                    start_utf16: 0,
                    end_utf16: 0,
                    text: "X".to_string(),
                },
                TextEdit {
                    start_utf16: 999,
                    end_utf16: 999,
                    text: "Y".to_string(),
                },
            ],
        };

        assert!(apply_edits_internal(request, session.value()).is_err());
        let snapshot = session.snapshot.load();
        assert_eq!(snapshot.version, 0);
        assert_eq!(snapshot.content.to_string(), "alpha");
        assert!(session.recent_batches.lock().unwrap().is_empty());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn oversized_file_is_rejected_before_a_session_is_created() {
        let state = EditorState::new();
        let path = test_file("");
        let file = OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("open fixture");
        file.set_len(MAX_EDITOR_FILE_BYTES + 1)
            .expect("grow fixture");
        let path_string = path.to_string_lossy().to_string();

        let error = open_file_internal(&path_string, &state).expect_err("must reject large file");
        assert_eq!(error.code, "file_too_large");
        assert!(state.sessions.is_empty());
        let _ = std::fs::remove_file(path);
    }

    #[cfg(unix)]
    #[test]
    fn copied_unix_permissions_are_applied_to_the_temporary_file() {
        use std::os::unix::fs::PermissionsExt;

        let source = test_file("source");
        let target = test_file("target");
        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o640))
            .expect("set source mode");
        let permissions = std::fs::metadata(&source).unwrap().permissions();
        std::fs::set_permissions(&target, permissions).expect("copy mode");
        let mode = std::fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(target);
    }

    #[test]
    fn utf16_surrogate_boundaries_are_rejected() {
        let rope = Rope::from_str("A😀B");
        assert_eq!(utf16_to_char_idx_strict(&rope, 1).unwrap(), 1);
        assert!(utf16_to_char_idx_strict(&rope, 2).is_err());
        assert_eq!(utf16_to_char_idx_strict(&rope, 3).unwrap(), 2);
    }

    #[test]
    fn highlighter_rules_initialize_without_panicking() {
        for language in [
            "rust",
            "typescript",
            "python",
            "json",
            "css",
            "html",
            "plain-text",
        ] {
            let _ = get_rules(language);
        }
    }

    #[test]
    fn multiline_highlighting_closes_state_at_delimiter() {
        let (_, python_state) =
            highlight_line_stateful("r\"\"\"open", "python", LexerState::Normal);
        assert_eq!(python_state, LexerState::InDocStringDouble);
        let (python_tokens, python_end) =
            highlight_line_stateful("close\"\"\" + 1", "python", python_state);
        assert_eq!(python_end, LexerState::Normal);
        assert_eq!(&python_tokens[..3], &[0, 8, TOKEN_STRING]);

        let (_, comment_state) = highlight_line_stateful("/* open", "rust", LexerState::Normal);
        assert_eq!(comment_state, LexerState::InBlockComment);
        let (_, comment_end) = highlight_line_stateful("close */ let", "rust", comment_state);
        assert_eq!(comment_end, LexerState::Normal);
    }
}
