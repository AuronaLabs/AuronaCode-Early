//! Editor IPC adapters over revisioned text transactions.
use super::*;

#[tauri::command]
pub async fn open_editor_file(
    app: tauri::AppHandle,
    path: String,
    state: State<'_, EditorState>,
    workspace: State<'_, crate::workspace::WorkspaceState>,
) -> Result<EditorSnapshotResponse, DesktopError> {
    let (directory, name) = workspace
        .file_access(&path)
        .map_err(|error| DesktopError::editor("path_not_authorized", error, false))?;
    let generation = workspace.generation();
    let sessions = Arc::clone(&state.sessions);
    spawn_blocking_editor(move || {
        let editor_state = EditorState { sessions };
        let result = open_scoped_file(&path, &editor_state, &directory, &name, generation)?;
        if app.state::<crate::workspace::WorkspaceState>().generation() != generation {
            return Err(DesktopError::editor(
                "workspace_changed",
                "工作区已切换",
                true,
            ));
        }
        Ok(result)
    })
    .await
}

/// Opens a file chosen through the system dialog. The dialog runs inside Rust,
/// so the returned path is the user's own selection and is authorized even
/// when it lives outside the active workspace.
#[tauri::command]
pub async fn editor_open_dialog(
    app: tauri::AppHandle,
    state: State<'_, EditorState>,
    workspace: State<'_, crate::workspace::WorkspaceState>,
) -> Result<Option<EditorSnapshotResponse>, DesktopError> {
    use tauri_plugin_dialog::DialogExt;

    let initial_directory = workspace.root().map_err(|error| {
        DesktopError::editor(
            "authorization_failed",
            format!("无法读取工作区根目录：{error}"),
            true,
        )
    })?;
    let dialog_app = app.clone();
    let generation = workspace.generation();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = dialog_app.dialog().file();
        if let Some(directory) = initial_directory {
            dialog = dialog.set_directory(directory);
        }
        dialog.blocking_pick_file()
    })
    .await
    .map_err(|error| {
        DesktopError::editor(
            "dialog_task_failed",
            format!("文件对话框任务失败：{error}"),
            true,
        )
    })?;

    let Some(picked) = picked else {
        return Ok(None);
    };
    if workspace.generation() != generation {
        return Err(DesktopError::editor(
            "workspace_changed",
            "文件选择期间工作区已切换",
            true,
        ));
    }
    let path = match picked {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        tauri_plugin_dialog::FilePath::Url(_) => {
            return Err(DesktopError::editor(
                "dialog_url_unsupported",
                "文件对话框返回了不支持的 URL",
                false,
            ));
        }
    };
    let path_string = path.to_string_lossy().into_owned();
    workspace
        .authorize_path_at(&path_string, generation)
        .map_err(|error| {
            DesktopError::editor(
                "authorization_failed",
                format!("无法授权打开文件：{error}"),
                true,
            )
        })?;
    let (directory, name) = workspace
        .file_access(&path_string)
        .map_err(|error| DesktopError::editor("path_not_authorized", error, false))?;
    let sessions = Arc::clone(&state.sessions);
    spawn_blocking_editor(move || {
        let editor_state = EditorState { sessions };
        let result = open_scoped_file(&path_string, &editor_state, &directory, &name, generation)?;
        if app.state::<crate::workspace::WorkspaceState>().generation() != generation {
            return Err(DesktopError::editor(
                "workspace_changed",
                "工作区已切换",
                true,
            ));
        }
        Ok(result)
    })
    .await
    .map(Some)
}

#[tauri::command]
pub async fn apply_editor_edits(
    request: ApplyEditsRequest,
    state: State<'_, EditorState>,
) -> Result<ApplyEditsResponse, DesktopError> {
    let normalized_path = normalize_path(&request.path);
    let session = state
        .sessions
        .get(&normalized_path)
        .map(|entry| Arc::clone(entry.value()))
        .ok_or_else(|| {
            DesktopError::editor(
                "session_not_found",
                format!("未找到该文件的编辑器会话: {normalized_path}"),
                true,
            )
        })?;
    spawn_blocking_editor(move || apply_edits_internal(request, &session)).await
}

#[tauri::command]
pub async fn get_editor_lines(
    path: String,
    start_line: usize,
    end_line: usize,
    state: State<'_, EditorState>,
) -> Result<EditorLinesResponse, DesktopError> {
    let sessions = Arc::clone(&state.sessions);
    spawn_blocking_editor(move || {
        let editor_state = EditorState { sessions };
        get_lines_internal(&path, start_line, end_line, &editor_state)
    })
    .await
}

#[tauri::command]
pub async fn save_editor_file(
    app: tauri::AppHandle,
    request: SaveEditorRequest,
    state: State<'_, EditorState>,
) -> Result<SaveEditorResponse, DesktopError> {
    let workspace = app.state::<crate::workspace::WorkspaceState>();
    let generation = workspace.generation();
    let (directory, name) = workspace
        .file_access(&request.path)
        .map_err(|error| DesktopError::editor("path_not_authorized", error, false))?;
    let normalized_path = normalize_path(&request.path);
    let session = state
        .sessions
        .get(&normalized_path)
        .map(|entry| Arc::clone(entry.value()))
        .ok_or_else(|| {
            DesktopError::editor(
                "session_not_found",
                format!("未找到该文件的编辑器会话: {normalized_path}"),
                true,
            )
        })?;
    if session.workspace_generation.load(Ordering::Acquire) != generation {
        return Err(DesktopError::editor(
            "workspace_changed",
            "请重新授权当前文件后保存",
            true,
        ));
    }
    spawn_blocking_editor(move || {
        let mut result = None;
        app.state::<crate::workspace::WorkspaceState>()
            .with_generation(generation, || {
                result = Some(save_editor_file_internal(
                    request, &session, &directory, &name,
                ));
                Ok(())
            })
            .map_err(|error| DesktopError::editor("workspace_changed", error, true))?;
        result.unwrap()
    })
    .await
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
