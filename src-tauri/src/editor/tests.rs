use super::*;
use crate::highlight::{get_rules, TOKEN_STRING};
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
fn excessive_line_ranges_fail_before_materializing_output() {
    let state = EditorState::new();
    let path = test_file("before\nsecond");
    let path_string = path.to_string_lossy().to_string();
    open_file_internal(&path_string, &state).unwrap();
    assert!(get_lines_internal(&path_string, 0, usize::MAX, &state).is_err());
    assert!(get_lines_internal(&path_string, 10, 0, &state).is_err());
    let lines = get_lines_internal(&path_string, 0, 2, &state).unwrap();
    assert_eq!(lines.lines.len(), 2);
    assert_eq!(lines.revision, 0);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn oversized_or_excessive_edits_preserve_document_and_revision() {
    let state = EditorState::new();
    let path = test_file("before");
    let path_string = path.to_string_lossy().to_string();
    open_file_internal(&path_string, &state).unwrap();
    let session = state.sessions.get(&normalize_path(&path_string)).unwrap();
    for edits in [
        vec![TextEdit {
            start_utf16: 0,
            end_utf16: 0,
            text: "x".repeat(crate::resource_limits::TEXT_BYTES),
        }],
        vec![
            TextEdit {
                start_utf16: 0,
                end_utf16: 0,
                text: String::new()
            };
            4097
        ],
    ] {
        let result = apply_edits_internal(
            ApplyEditsRequest {
                path: path_string.clone(),
                base_revision: 0,
                client_batch_id: "limit".into(),
                edits,
            },
            &session,
        );
        assert!(result.is_err());
        assert_eq!(session.snapshot.load().version, 0);
        assert_eq!(session.snapshot.load().content.to_string(), "before");
    }
    drop(session);
    state.sessions.clear();
    std::fs::remove_file(path).unwrap();
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
    let (_, python_state) = highlight_line_stateful("r\"\"\"open", "python", LexerState::Normal);
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
