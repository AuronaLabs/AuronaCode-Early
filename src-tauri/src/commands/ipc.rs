use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct IpcRequest {
    pub action: String,
    pub _payload: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct IpcResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn aurona_bridge(req: IpcRequest) -> IpcResponse {
    let result = match req.action.as_str() {
        "sys:ping" => Ok(serde_json::json!("pong")),
        // Migrated IPC routes will go here
        _ => Err(format!("Unknown IPC Action: {}", req.action)),
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

#[tauri::command]
pub fn open_devtools(_window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(any(debug_assertions, feature = "devtools"))]
    {
        _window.open_devtools();
        Ok(())
    }

    #[cfg(not(any(debug_assertions, feature = "devtools")))]
    {
        Err("开发者工具在当前生产版本中未启用".to_string())
    }
}

use std::fs;
use std::path::Path;
use tauri::Manager;

fn get_dir_size(path: &Path) -> u64 {
    let mut size = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_dir() {
                    size += get_dir_size(&entry.path());
                } else {
                    size += metadata.len();
                }
            }
        }
    }
    size
}

#[tauri::command]
pub fn get_app_data_size(app: tauri::AppHandle) -> Result<u64, String> {
    if let Ok(path) = app.path().app_local_data_dir() {
        Ok(get_dir_size(&path))
    } else {
        Err("Failed to get app local data dir".to_string())
    }
}

#[tauri::command]
pub fn get_app_log_size(app: tauri::AppHandle) -> u64 {
    if let Ok(log_dir) = app.path().app_log_dir() {
        get_dir_size(&log_dir)
    } else {
        0
    }
}

#[tauri::command]
pub fn clear_app_logs(app: tauri::AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get app log dir: {e}"))?;

    if !log_dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(&log_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_dir() {
            fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn clear_other_app_data(app: tauri::AppHandle) -> Result<(), String> {
    if let Ok(app_dir) = app.path().app_local_data_dir() {
        if let Ok(entries) = fs::read_dir(&app_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                // Skip the configuration files
                if name == "user-config.json" || name == "workspace.json" {
                    continue;
                }
                let path = entry.path();
                if path.is_dir() {
                    let _ = fs::remove_dir_all(path);
                } else {
                    let _ = fs::remove_file(path);
                }
            }
        }
        Ok(())
    } else {
        Err("Failed to get app local data dir".to_string())
    }
}

#[tauri::command]
pub fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(splashscreen) = app.get_webview_window("splashscreen") {
        let _ = splashscreen.close();
    }
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.maximize();
        let _ = main_window.set_focus();
    }
}
