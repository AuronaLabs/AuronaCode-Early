//! 编辑器行级语法高亮器：按语言规则表做有状态行扫描（docstring / 块注释跨行状态）。
//! 从 editor.rs 拆出（v0.4.2），纯移动不改逻辑。

use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum LexerState {
    Normal,
    InDocStringDouble, // Python """
    InDocStringSingle, // Python '''
    InBlockComment,    // JS/Rust/CSS /* */
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

pub fn get_rules(lang: &str) -> &'static Vec<TokenRule> {
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
