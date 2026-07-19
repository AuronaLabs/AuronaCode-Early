use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Manager, State};

use crate::performance::PerformanceState;

#[derive(Deserialize)]
pub struct IpcRequest {
    pub action: String,
    #[serde(default)]
    pub payload: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct IpcResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn aurona_bridge(req: IpcRequest) -> IpcResponse {
    let action = req.action.trim();
    // Routes are migrated incrementally. Deserialize the payload now so the
    // bridge contract remains stable even for actions that do not consume it yet.
    let _payload = req.payload;
    let result = match action {
        "sys:ping" => Ok(serde_json::json!("pong")),
        // Migrated IPC routes will go here
        _ if action.is_empty() => Err("IPC action must not be empty".to_string()),
        _ => Err(format!("Unknown IPC Action: {action}")),
    };

    match result {
        Ok(data) => IpcResponse {
            success: true,
            data: Some(data),
            error: None,
        },
        Err(err) => IpcResponse {
            success: false,
            data: None,
            error: Some(err),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{clear_directory_contents, get_dir_size, IpcRequest};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_directory() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("aurona-ipc-test-{unique}"))
    }

    #[test]
    fn request_deserializes_the_frontend_payload_field() {
        let request: IpcRequest = serde_json::from_value(serde_json::json!({
            "action": "sys:ping",
            "payload": { "source": "test" }
        }))
        .expect("the frontend IPC request shape should deserialize");

        assert_eq!(
            request.payload,
            Some(serde_json::json!({ "source": "test" }))
        );
    }

    #[test]
    fn storage_cleanup_preserves_configuration_and_reports_nested_size() {
        let root = temp_directory();
        let nested = root.join("cache").join("nested");
        fs::create_dir_all(&nested).expect("test directories should be created");
        fs::write(root.join("user-config.json"), "config").expect("config should be written");
        fs::write(root.join("workspace.json"), "workspace").expect("workspace should be written");
        fs::write(root.join("editor-recovery.json"), "recovery")
            .expect("recovery marker should be written");
        fs::write(nested.join("payload.bin"), "payload").expect("cache payload should be written");

        assert_eq!(get_dir_size(&root).expect("size should be calculated"), 30);

        clear_directory_contents(
            &root,
            &["user-config.json", "workspace.json", "editor-recovery.json"],
        )
        .expect("cleanup should succeed");

        assert!(root.join("user-config.json").exists());
        assert!(root.join("workspace.json").exists());
        assert!(root.join("editor-recovery.json").exists());
        assert!(!root.join("cache").exists());

        fs::remove_dir_all(root).expect("test directory should be removed");
    }
}

#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    // Aurona deliberately exposes DevTools through the explicit application menu
    // in release builds. The Tauri dependency is compiled with its `devtools`
    // feature, so a crate-local cfg gate would incorrectly reject this command.
    window.open_devtools();
    Ok(())
}

use std::fs;
use std::path::Path;

fn get_dir_size(path: &Path) -> Result<u64, String> {
    let mut total = 0_u64;
    let mut directories = vec![path.to_path_buf()];

    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("Unable to read {}: {error}", directory.display()))?
        {
            let entry =
                entry.map_err(|error| format!("Unable to read directory entry: {error}"))?;
            let file_type = entry.file_type().map_err(|error| {
                format!("Unable to inspect {}: {error}", entry.path().display())
            })?;

            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                directories.push(entry.path());
            } else if file_type.is_file() {
                let length = entry
                    .metadata()
                    .map_err(|error| {
                        format!("Unable to inspect {}: {error}", entry.path().display())
                    })?
                    .len();
                total = total
                    .checked_add(length)
                    .ok_or_else(|| "Directory size exceeds supported range".to_string())?;
            }
        }
    }

    Ok(total)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageBreakdown {
    pub app_data_bytes: u64,
    pub log_bytes: u64,
    pub config_bytes: u64,
    pub workspace_bytes: u64,
    pub recovery_bytes: u64,
    pub other_app_data_bytes: u64,
}

fn file_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    path.metadata()
        .map(|metadata| metadata.len())
        .map_err(|error| format!("Unable to inspect {}: {error}", path.display()))
}

#[tauri::command]
pub async fn get_storage_breakdown(app: tauri::AppHandle) -> Result<StorageBreakdown, String> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?;
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("Failed to get app log dir: {error}"))?;

    tokio::task::spawn_blocking(move || {
        let app_data_bytes = get_dir_size(&app_dir)?;
        let config_bytes = file_size(&app_dir.join("user-config.json"))?;
        let workspace_bytes = file_size(&app_dir.join("workspace.json"))?;
        let recovery_bytes = get_dir_size(&app_dir.join("editor-recovery")).unwrap_or(0);
        let other_app_data_bytes = app_data_bytes
            .saturating_sub(config_bytes)
            .saturating_sub(workspace_bytes)
            .saturating_sub(recovery_bytes);
        Ok(StorageBreakdown {
            app_data_bytes,
            log_bytes: get_dir_size(&log_dir).unwrap_or(0),
            config_bytes,
            workspace_bytes,
            recovery_bytes,
            other_app_data_bytes,
        })
    })
    .await
    .map_err(|error| format!("Storage breakdown task failed: {error}"))?
}

#[tauri::command]
pub async fn get_app_data_size(app: tauri::AppHandle) -> Result<u64, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?;
    tokio::task::spawn_blocking(move || get_dir_size(&path))
        .await
        .map_err(|error| format!("App data size task failed: {error}"))?
}

#[tauri::command]
pub async fn get_app_log_size(app: tauri::AppHandle) -> Result<u64, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("Failed to get app log dir: {error}"))?;
    tokio::task::spawn_blocking(move || get_dir_size(&log_dir))
        .await
        .map_err(|error| format!("App log size task failed: {error}"))?
}

#[tauri::command]
pub async fn clear_app_logs(app: tauri::AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get app log dir: {e}"))?;

    tokio::task::spawn_blocking(move || clear_directory_contents(&log_dir, &[]))
        .await
        .map_err(|error| format!("Log cleanup task failed: {error}"))?
}

#[tauri::command]
pub async fn clear_other_app_data(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?;
    tokio::task::spawn_blocking(move || {
        clear_directory_contents(
            &app_dir,
            &["user-config.json", "workspace.json", "editor-recovery"],
        )
    })
    .await
    .map_err(|error| format!("App data cleanup task failed: {error}"))?
}

#[tauri::command]
pub async fn clear_editor_recovery(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?;
    tokio::task::spawn_blocking(move || {
        clear_directory_contents(&app_dir.join("editor-recovery"), &[])
    })
    .await
    .map_err(|error| format!("Editor recovery cleanup task failed: {error}"))?
}

fn clear_directory_contents(path: &Path, preserved_names: &[&str]) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    for entry in
        fs::read_dir(path).map_err(|error| format!("Unable to read {}: {error}", path.display()))?
    {
        let entry = entry.map_err(|error| format!("Unable to read directory entry: {error}"))?;
        let name = entry.file_name();
        if preserved_names.iter().any(|preserved| name == *preserved) {
            continue;
        }

        let entry_path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Unable to inspect {}: {error}", entry_path.display()))?;
        if file_type.is_dir() {
            fs::remove_dir_all(&entry_path)
                .map_err(|error| format!("Unable to remove {}: {error}", entry_path.display()))?;
        } else {
            fs::remove_file(&entry_path)
                .map_err(|error| format!("Unable to remove {}: {error}", entry_path.display()))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn mark_splashscreen_shown(state: State<PerformanceState>) -> Result<(), String> {
    state.mark_splash_shown()
}

#[tauri::command]
pub async fn close_splashscreen(
    app: tauri::AppHandle,
    state: State<'_, PerformanceState>,
) -> Result<(), String> {
    let remaining = state.splash_remaining(Duration::from_secs(2))?;
    if !remaining.is_zero() {
        tokio::time::sleep(remaining).await;
    }

    if let Some(main_window) = app.get_webview_window("main") {
        main_window
            .show()
            .map_err(|error| format!("Unable to show main window: {error}"))?;
        let _ = main_window.set_focus();
    }
    if let Some(splashscreen) = app.get_webview_window("splashscreen") {
        let _ = splashscreen.close();
    }
    Ok(())
}
