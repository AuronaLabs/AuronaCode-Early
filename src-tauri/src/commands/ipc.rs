use serde::Serialize;
use std::time::Duration;
use tauri::{Manager, State};

use crate::performance::PerformanceState;

#[cfg(test)]
mod tests {
    use super::{clear_directory_contents, get_dir_size};
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
    pub performance_bytes: u64,
    pub cache_bytes: u64,
    pub errlog_bytes: u64,
    pub extension_bytes: u64,
    pub extension_storage_bytes: u64,
    pub toolchain_bytes: u64,
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
        let performance_bytes = file_size(&app_dir.join("performance-baseline.json"))?;
        let cache_bytes = get_dir_size(&app_dir.join("EBWebView")).unwrap_or(0);
        let errlog_bytes = get_dir_size(&app_dir.join("errlogs")).unwrap_or(0);
        let extension_bytes = get_dir_size(&app_dir.join("extensions")).unwrap_or(0);
        let extension_storage_bytes = get_dir_size(&app_dir.join("extension-storage")).unwrap_or(0);
        let toolchain_bytes = get_dir_size(&app_dir.join("toolchains")).unwrap_or(0);
        let log_bytes = get_dir_size(&log_dir).unwrap_or(0);
        let accounted = config_bytes
            .saturating_add(workspace_bytes)
            .saturating_add(recovery_bytes)
            .saturating_add(performance_bytes)
            .saturating_add(cache_bytes)
            .saturating_add(errlog_bytes)
            .saturating_add(extension_bytes)
            .saturating_add(extension_storage_bytes)
            .saturating_add(toolchain_bytes)
            .saturating_add(log_bytes);
        let other_app_data_bytes = app_data_bytes.saturating_sub(accounted);
        Ok(StorageBreakdown {
            app_data_bytes,
            log_bytes,
            config_bytes,
            workspace_bytes,
            recovery_bytes,
            performance_bytes,
            cache_bytes,
            errlog_bytes,
            extension_bytes,
            extension_storage_bytes,
            toolchain_bytes,
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
pub async fn clear_err_logs(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?;
    tokio::task::spawn_blocking(move || clear_directory_contents(&app_dir.join("errlogs"), &[]))
        .await
        .map_err(|error| format!("Error log cleanup task failed: {error}"))?
}

#[tauri::command]
pub async fn clear_webview_cache(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?;
    tokio::task::spawn_blocking(move || clear_directory_contents(&app_dir.join("EBWebView"), &[]))
        .await
        .map_err(|error| format!("WebView cache cleanup task failed: {error}"))?
}

#[tauri::command]
pub async fn clear_performance_baseline(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?;
    tokio::task::spawn_blocking(move || {
        let baseline = app_dir.join("performance-baseline.json");
        if baseline.exists() {
            fs::remove_file(&baseline)
                .map_err(|error| format!("Unable to remove performance baseline: {error}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Performance baseline cleanup task failed: {error}"))?
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

#[tauri::command]
pub async fn open_app_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?;
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("explorer").arg(&path).spawn();
        }
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("open").arg(&path).spawn();
        }
        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Open folder task failed: {e}"))?
}

#[tauri::command]
pub async fn clear_extension_storage(app: tauri::AppHandle) -> Result<u64, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?
        .join("extension-storage");
    tokio::task::spawn_blocking(move || {
        let size = get_dir_size(&path).unwrap_or(0);
        if path.exists() {
            let _ = fs::remove_dir_all(&path);
            let _ = fs::create_dir_all(&path);
        }
        Ok(size)
    })
    .await
    .map_err(|error| format!("Clear extension storage failed: {error}"))?
}

#[tauri::command]
pub async fn clear_extension_storage_for(
    app: tauri::AppHandle,
    extension_id: String,
) -> Result<u64, String> {
    // The extension id becomes a single directory name below extension-storage;
    // reject anything that could escape that directory.
    if extension_id.is_empty()
        || extension_id.len() > 128
        || extension_id.contains(['\\', '/', ':', '*'])
        || extension_id == ".."
        || extension_id.contains("..")
    {
        return Err(format!("Invalid extension id: {extension_id}"));
    }
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?
        .join("extension-storage")
        .join(extension_id);
    tokio::task::spawn_blocking(move || {
        if !path.exists() {
            return Ok(0);
        }
        let size = get_dir_size(&path).unwrap_or(0);
        fs::remove_dir_all(&path)
            .map_err(|error| format!("Clear extension storage failed: {error}"))?;
        Ok(size)
    })
    .await
    .map_err(|error| format!("Clear extension storage failed: {error}"))?
}

#[tauri::command]
pub async fn clear_toolchains(app: tauri::AppHandle) -> Result<u64, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to get app local data dir: {error}"))?
        .join("toolchains");
    tokio::task::spawn_blocking(move || {
        let size = get_dir_size(&path).unwrap_or(0);
        if path.exists() {
            let _ = fs::remove_dir_all(&path);
            let _ = fs::create_dir_all(&path);
        }
        Ok(size)
    })
    .await
    .map_err(|error| format!("Clear toolchains failed: {error}"))?
}
