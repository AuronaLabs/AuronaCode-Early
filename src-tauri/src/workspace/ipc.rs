//! Tauri adapters; IPC names and argument formats remain compatible.
use super::filesystem::{DirectoryPage, FsEntry};
use super::*;

#[tauri::command]
pub fn reveal_in_os(state: State<WorkspaceState>, path: String) -> Result<(), String> {
    super::filesystem::reveal_in_os(state, path)
}

#[tauri::command]
pub async fn fs_copy_or_move(
    app: tauri::AppHandle,
    source: String,
    destination: String,
    is_move: bool,
) -> Result<(), String> {
    super::filesystem::fs_copy_or_move(app, source, destination, is_move).await
}

#[tauri::command]
pub fn fs_read_dir_page(
    state: State<'_, WorkspaceState>,
    path: String,
    cursor: Option<String>,
) -> Result<DirectoryPage, String> {
    super::filesystem::fs_read_dir_page(state, path, cursor)
}

#[tauri::command]
pub fn fs_cancel_dir_cursor(
    state: State<'_, WorkspaceState>,
    cursor: String,
) -> Result<(), String> {
    super::filesystem::fs_cancel_dir_cursor(state, cursor)
}

#[tauri::command]
pub async fn workspace_set_root(
    app: tauri::AppHandle,
    state: State<'_, WorkspaceState>,
    root: Option<String>,
) -> Result<(), String> {
    super::filesystem::workspace_set_root(app, state, root).await
}

#[tauri::command]
pub async fn fs_read_dir(app: tauri::AppHandle, path: String) -> Result<Vec<FsEntry>, String> {
    super::filesystem::fs_read_dir(app, path).await
}

#[tauri::command]
pub async fn fs_exists(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    super::filesystem::fs_exists(app, path).await
}

#[tauri::command]
pub async fn fs_read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    super::filesystem::fs_read_text_file(app, path).await
}

#[tauri::command]
pub async fn fs_read_image_data_url(app: tauri::AppHandle, path: String) -> Result<String, String> {
    super::filesystem::fs_read_image_data_url(app, path).await
}

#[tauri::command]
pub async fn fs_write_text_file(
    app: tauri::AppHandle,
    path: String,
    contents: String,
) -> Result<(), String> {
    super::filesystem::fs_write_text_file(app, path, contents).await
}

#[tauri::command]
pub fn workspace_generation(state: State<'_, WorkspaceState>) -> u64 {
    super::filesystem::workspace_generation(state)
}

#[tauri::command]
pub async fn fs_write_compare(
    app: tauri::AppHandle,
    path: String,
    contents: String,
    expected_fingerprint: String,
    generation: u64,
) -> Result<(), String> {
    super::filesystem::fs_write_compare(app, path, contents, expected_fingerprint, generation).await
}

#[tauri::command]
pub async fn fs_mkdir(app: tauri::AppHandle, path: String, recursive: bool) -> Result<(), String> {
    super::filesystem::fs_mkdir(app, path, recursive).await
}

#[tauri::command]
pub async fn fs_remove(app: tauri::AppHandle, path: String, recursive: bool) -> Result<(), String> {
    super::filesystem::fs_remove(app, path, recursive).await
}

#[tauri::command]
pub async fn fs_restore_deleted(
    app: tauri::AppHandle,
    recovery_id: String,
) -> Result<String, String> {
    super::filesystem::fs_restore_deleted(app, recovery_id).await
}

#[tauri::command]
pub async fn fs_rename(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    super::filesystem::fs_rename(app, from, to).await
}

#[tauri::command]
pub async fn fs_export_dialog_file(
    app: tauri::AppHandle,
    contents: String,
    default_name: String,
) -> Result<Option<String>, String> {
    super::filesystem::fs_export_dialog_file(app, contents, default_name).await
}

#[tauri::command]
pub fn fs_watch_start(
    app: tauri::AppHandle,
    state: State<WorkspaceState>,
    path: String,
    recursive: bool,
) -> Result<String, String> {
    super::filesystem::fs_watch_start(app, state, path, recursive)
}

#[tauri::command]
pub fn fs_watch_stop(state: State<WorkspaceState>, id: String) -> Result<(), String> {
    super::filesystem::fs_watch_stop(state, id)
}
