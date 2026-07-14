use arc_swap::ArcSwap;
use dashmap::DashMap;
use regex::Regex;
use ropey::Rope;
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::State;

#[derive(Clone)]
pub struct DocumentSnapshot {
    pub version: u64,
    pub content: Rope,
}

pub struct EditorSession {
    pub language: String,
    pub line_ending: String,
    pub write_lock: Mutex<()>,
    pub snapshot: ArcSwap<DocumentSnapshot>,
    pub line_states: Mutex<Vec<LexerState>>,
}

impl EditorSession {
    pub fn new(language: String, line_ending: String, rope: Rope) -> Self {
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
        }
    }
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
pub fn utf16_to_char_idx(rope: &Rope, utf16_idx: usize) -> usize {
    if utf16_idx == 0 {
        return 0;
    }
    let mut current_utf16 = 0;
    let mut current_char = 0;

    for chunk in rope.chunks() {
        for c in chunk.chars() {
            if current_utf16 >= utf16_idx {
                return current_char;
            }
            current_utf16 += if (c as u32) > 0xFFFF { 2 } else { 1 };
            current_char += 1;
        }
    }
    current_char
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
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^(?i)[rfb]*"""(?:[^"\\]|\\.|"(?!"")|""(?!""))*""""#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^(?i)[rfb]*'''(?:[^'\\]|\\.|'(?!'')|''(?!''))*'''"#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^(?i)[rfb]*"([^"\\]|\\.)*""#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^(?i)[rfb]*'([^'\\]|\\.)*'"#).unwrap(), capture_group: None },
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
                TokenRule { token_type: TOKEN_SPECIAL_DECORATOR, regex: Regex::new(r#"^"[a-zA-Z0-9_-]+"\s*(?=:)"#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_STRING, regex: Regex::new(r#"^"([^"\\]|\\.)*""#).unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_NUMBER, regex: Regex::new(r"^\b\d+(\.\d+)?\b").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_KEYWORD, regex: Regex::new(r"^\b(true|false|null)\b").unwrap(), capture_group: None },
            ]
        }),
        "css" => CSS_RULES.get_or_init(|| {
            vec![
                TokenRule { token_type: TOKEN_KEYWORD, regex: Regex::new(r"^(\.[a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+)").unwrap(), capture_group: None },
                TokenRule { token_type: TOKEN_SPECIAL_DECORATOR, regex: Regex::new(r"^([a-zA-Z0-9_-]+)\s*(?=:)").unwrap(), capture_group: Some(1) },
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
        _ => DEFAULT_RULES.get_or_init(|| vec![]),
    }
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
                static PY_DOC_DOUBLE_END: OnceLock<Regex> = OnceLock::new();
                let re_end = PY_DOC_DOUBLE_END.get_or_init(|| Regex::new(r#"(?s).*?""""#).unwrap());
                if let Some(mat) = re_end.find(remaining) {
                    let start_utf16 = get_utf16_idx(i);
                    let len_utf16 = get_utf16_idx(i + mat.end()) - start_utf16;
                    tokens.push(start_utf16);
                    tokens.push(len_utf16);
                    tokens.push(TOKEN_STRING);

                    i += mat.end();
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
                static PY_DOC_SINGLE_END: OnceLock<Regex> = OnceLock::new();
                let re_end = PY_DOC_SINGLE_END.get_or_init(|| Regex::new(r#"(?s).*?'''"#).unwrap());
                if let Some(mat) = re_end.find(remaining) {
                    let start_utf16 = get_utf16_idx(i);
                    let len_utf16 = get_utf16_idx(i + mat.end()) - start_utf16;
                    tokens.push(start_utf16);
                    tokens.push(len_utf16);
                    tokens.push(TOKEN_STRING);

                    i += mat.end();
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
                static BLOCK_COMMENT_END: OnceLock<Regex> = OnceLock::new();
                let re_end = BLOCK_COMMENT_END.get_or_init(|| Regex::new(r#"(?s).*?\*/"#).unwrap());
                if let Some(mat) = re_end.find(remaining) {
                    let start_utf16 = get_utf16_idx(i);
                    let len_utf16 = get_utf16_idx(i + mat.end()) - start_utf16;
                    tokens.push(start_utf16);
                    tokens.push(len_utf16);
                    tokens.push(TOKEN_COMMENT);

                    i += mat.end();
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
            static PY_START_DOUBLE_TRIPLE: OnceLock<Regex> = OnceLock::new();
            let re_start_double = PY_START_DOUBLE_TRIPLE.get_or_init(|| {
                Regex::new(r#"^(?i)[rfb]*"""(?:[^"\\]|\\.|"(?!"")|""(?!""))*$"#).unwrap()
            });
            if re_start_double.is_match(remaining) {
                let start_utf16 = get_utf16_idx(i);
                let len_utf16 = get_utf16_idx(byte_len) - start_utf16;
                tokens.push(start_utf16);
                tokens.push(len_utf16);
                tokens.push(TOKEN_STRING);
                current_state = LexerState::InDocStringDouble;
                break;
            }

            static PY_START_SINGLE_TRIPLE: OnceLock<Regex> = OnceLock::new();
            let re_start_single = PY_START_SINGLE_TRIPLE.get_or_init(|| {
                Regex::new(r#"^(?i)[rfb]*'''(?:[^'\\]|\\.|'(?!'')|''(?!''))*$"#).unwrap()
            });
            if re_start_single.is_match(remaining) {
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
        ) {
            static BLOCK_COMMENT_START: OnceLock<Regex> = OnceLock::new();
            let re_start_block = BLOCK_COMMENT_START
                .get_or_init(|| Regex::new(r#"^/\*(?:[^*]|\*(?!/))*$"#).unwrap());
            if re_start_block.is_match(remaining) {
                let start_utf16 = get_utf16_idx(i);
                let len_utf16 = get_utf16_idx(byte_len) - start_utf16;
                tokens.push(start_utf16);
                tokens.push(len_utf16);
                tokens.push(TOKEN_COMMENT);
                current_state = LexerState::InBlockComment;
                break;
            }
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

pub fn open_file_internal(path: &str, state: &EditorState) -> Result<String, String> {
    let normalized_path = Path::new(path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string());

    if let Some(session) = state.sessions.get(&normalized_path) {
        let snap = session.snapshot.load();
        return Ok(snap.content.to_string());
    }

    let language = detect_language(&normalized_path);
    let file = File::open(&normalized_path).map_err(|e| format!("无法打开文件: {e}"))?;
    let source_rope =
        Rope::from_reader(BufReader::new(file)).map_err(|e| format!("无法解析文本: {e}"))?;
    let source_content = source_rope.to_string();
    let line_ending = if source_content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let content = source_content.replace("\r\n", "\n");
    let rope = Rope::from_str(&content);
    let session = Arc::new(EditorSession::new(language, line_ending.to_string(), rope));
    state.sessions.insert(normalized_path, session);

    Ok(content)
}

pub fn get_lines_internal(
    path: &str,
    start_line: usize,
    end_line: usize,
    state: &EditorState,
) -> Result<Vec<LineRenderData>, String> {
    let normalized_path = Path::new(path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string());

    let session = state
        .sessions
        .get(&normalized_path)
        .ok_or_else(|| format!("未找到该文件的编辑器会话: {normalized_path}"))?;

    let snap = session.snapshot.load();
    let rope = &snap.content;
    let total_lines = rope.len_lines();

    if start_line >= total_lines {
        return Ok(vec![]);
    }

    let actual_end = std::cmp::min(end_line, total_lines);
    let mut lines = Vec::with_capacity(actual_end - start_line);

    let mut states_guard = session.line_states.lock().map_err(|_| "获取状态锁失败")?;
    if states_guard.len() != total_lines {
        states_guard.resize(total_lines, LexerState::Normal);
    }

    for idx in start_line..actual_end {
        let line_slice = rope.line(idx);
        let mut line_str = line_slice.to_string();

        if line_str.ends_with('\n') {
            line_str.pop();
            if line_str.ends_with('\r') {
                line_str.pop();
            }
        } else if line_str.ends_with('\r') {
            line_str.pop();
        }

        let initial_state = if idx == 0 {
            LexerState::Normal
        } else {
            states_guard[idx - 1]
        };

        let (tokens, end_state) =
            highlight_line_stateful(&line_str, &session.language, initial_state);
        states_guard[idx] = end_state;

        lines.push(LineRenderData {
            text: line_str,
            tokens,
        });
    }

    Ok(lines)
}

// ── Tauri Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn open_editor_file(path: String, state: State<'_, EditorState>) -> Result<String, String> {
    open_file_internal(&path, &*state)
}

#[tauri::command]
pub fn apply_editor_edit(
    path: String,
    start_utf16: usize,
    end_utf16: usize,
    text: String,
    state: State<'_, EditorState>,
) -> Result<u64, String> {
    let normalized_path = Path::new(&path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.clone());

    let session = state
        .sessions
        .get(&normalized_path)
        .ok_or_else(|| format!("未找到该文件的编辑器会话: {normalized_path}"))?
        .clone();

    let _guard = session.write_lock.lock().map_err(|_| "写锁获取失败")?;

    let old_snap = session.snapshot.load();
    let old_rope = &old_snap.content;

    let start_char = utf16_to_char_idx(old_rope, start_utf16);
    let end_char = utf16_to_char_idx(old_rope, end_utf16);

    if start_char > old_rope.len_chars() || end_char > old_rope.len_chars() || start_char > end_char
    {
        return Err("编辑区间越界".to_string());
    }

    let start_line = old_rope.char_to_line(start_char);

    let mut new_rope = old_rope.clone();
    new_rope.remove(start_char..end_char);
    if !text.is_empty() {
        new_rope.insert(start_char, &text);
    }

    let new_version = old_snap.version + 1;
    let new_snap = Arc::new(DocumentSnapshot {
        version: new_version,
        content: new_rope.clone(),
    });

    let old_line_count = old_rope.len_lines();
    let new_line_count = new_rope.len_lines();

    let mut states_guard = session.line_states.lock().map_err(|_| "获取状态锁失败")?;

    if new_line_count != old_line_count {
        states_guard.resize(new_line_count, LexerState::Normal);
        for s in states_guard.iter_mut().skip(start_line) {
            *s = LexerState::Normal;
        }
    }

    let mut idx = start_line;
    while idx < new_line_count {
        let line_slice = new_rope.line(idx);
        let mut line_str = line_slice.to_string();
        if line_str.ends_with('\n') {
            line_str.pop();
            if line_str.ends_with('\r') {
                line_str.pop();
            }
        } else if line_str.ends_with('\r') {
            line_str.pop();
        }

        let initial_state = if idx == 0 {
            LexerState::Normal
        } else {
            states_guard[idx - 1]
        };

        let old_end_state = states_guard[idx];
        let (_, new_end_state) =
            highlight_line_stateful(&line_str, &session.language, initial_state);

        states_guard[idx] = new_end_state;

        if new_end_state == old_end_state && idx > start_line {
            break;
        }

        idx += 1;
    }

    session.snapshot.store(new_snap);

    Ok(new_version)
}

#[tauri::command]
pub fn get_editor_lines(
    path: String,
    start_line: usize,
    end_line: usize,
    state: State<'_, EditorState>,
) -> Result<Vec<LineRenderData>, String> {
    get_lines_internal(&path, start_line, end_line, &*state)
}

#[tauri::command]
pub fn save_editor_file(path: String, state: State<'_, EditorState>) -> Result<u64, String> {
    let normalized_path = Path::new(&path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.clone());

    let session = state
        .sessions
        .get(&normalized_path)
        .ok_or_else(|| format!("未找到该文件的编辑器会话: {normalized_path}"))?;

    let _guard = session.write_lock.lock().map_err(|_| "写锁获取失败")?;
    let snap = session.snapshot.load();

    let tmp_path = format!("{normalized_path}.aurona_save.tmp");
    {
        let file = File::create(&tmp_path).map_err(|e| format!("无法创建临时文件: {e}"))?;
        let mut writer = BufWriter::new(file);
        for chunk in snap.content.chunks() {
            if session.line_ending == "\r\n" {
                writer
                    .write_all(chunk.replace('\n', "\r\n").as_bytes())
                    .map_err(|e| format!("写入失败: {e}"))?;
            } else {
                writer
                    .write_all(chunk.as_bytes())
                    .map_err(|e| format!("写入失败: {e}"))?;
            }
        }
        writer.flush().map_err(|e| format!("刷新缓存失败: {e}"))?;
    }

    // `rename` cannot replace an existing destination on Windows. Move the current
    // file aside first so the same save path works on every supported platform,
    // and restore it if promoting the temporary file fails.
    if Path::new(&normalized_path).exists() {
        let backup_path = format!("{normalized_path}.aurona_save.bak");
        let _ = std::fs::remove_file(&backup_path);
        std::fs::rename(&normalized_path, &backup_path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("无法准备保存替换: {e}")
        })?;

        if let Err(error) = std::fs::rename(&tmp_path, &normalized_path) {
            let _ = std::fs::rename(&backup_path, &normalized_path);
            let _ = std::fs::remove_file(&tmp_path);
            return Err(format!("覆盖文件失败: {error}"));
        }

        let _ = std::fs::remove_file(&backup_path);
    } else {
        std::fs::rename(&tmp_path, &normalized_path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("创建文件失败: {e}")
        })?;
    }

    Ok(snap.version)
}

#[tauri::command]
pub fn close_editor_file(path: String, state: State<'_, EditorState>) -> Result<(), String> {
    let normalized_path = Path::new(&path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.clone());

    state.sessions.remove(&normalized_path);
    Ok(())
}

// ── Unit Tests ────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_internal_editor_logic() {
        let state = EditorState::new();
        let path = "Cargo.toml";

        let content = open_file_internal(path, &state).unwrap();
        assert!(!content.is_empty());
        println!("Content length: {}", content.len());

        let lines = get_lines_internal(path, 0, 10, &state).unwrap();
        println!("get_lines returned {} lines", lines.len());
        assert!(!lines.is_empty());
        for (i, line) in lines.iter().enumerate() {
            println!("Line {}: {:?}", i, line.text);
        }
    }
}
