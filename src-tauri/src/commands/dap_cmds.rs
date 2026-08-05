use crate::dap::{DapLaunch, DapSession, DapSessionInfo};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::time::Duration;

const DEBUGPY_VERSION: &str = "1.8.17";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonDebugpyStatus {
    installed: bool,
    version: Option<String>,
    message: String,
}

pub struct DapState {
    sessions: tokio::sync::Mutex<HashMap<String, Arc<DapSession>>>,
}

impl DapState {
    pub fn new() -> Self {
        Self {
            sessions: tokio::sync::Mutex::new(HashMap::new()),
        }
    }
}

impl Default for DapState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn dap_python_debugpy_status(python_path: String) -> Result<PythonDebugpyStatus, String> {
    let output = crate::process_service::capture_with_timeout(
        &python_path,
        &[
            "-c",
            "import debugpy; print(getattr(debugpy, '__version__', 'unknown'))",
        ],
        None,
        Duration::from_secs(8),
    )
    .map_err(|error| format!("无法检查 debugpy：{error}"))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(PythonDebugpyStatus {
            installed: true,
            version: Some(version.clone()),
            message: format!("debugpy {version} 已安装"),
        });
    }

    Ok(PythonDebugpyStatus {
        installed: false,
        version: None,
        message: format!(
            "当前 Python 环境尚未安装 debugpy。Aurona 可以将 debugpy {} 安装到该环境。",
            DEBUGPY_VERSION
        ),
    })
}

#[tauri::command]
pub async fn dap_install_python_debugpy(
    python_path: String,
) -> Result<PythonDebugpyStatus, String> {
    let package = format!("debugpy=={DEBUGPY_VERSION}");
    let output = crate::process_service::capture_with_timeout(
        &python_path,
        &["-m", "pip", "install", &package],
        None,
        Duration::from_secs(180),
    )
    .map_err(|error| format!("安装 debugpy 失败：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!("debugpy 安装失败：{detail}"));
    }

    dap_python_debugpy_status(python_path).await
}

#[tauri::command]
pub async fn dap_start(
    app: AppHandle,
    state: State<'_, DapState>,
    launch: DapLaunch,
) -> Result<DapSessionInfo, String> {
    if let Some(existing) = state.sessions.lock().await.remove(&launch.session_id) {
        existing.stop().await;
    }
    let session = DapSession::start(app, launch).await?;
    let info = session.info().await;
    state
        .sessions
        .lock()
        .await
        .insert(info.session_id.clone(), session);
    Ok(info)
}

#[tauri::command]
pub async fn dap_request(
    state: State<'_, DapState>,
    session_id: String,
    command: String,
    arguments: Value,
) -> Result<Value, String> {
    let session = state
        .sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "Debug session is not running".to_string())?;
    session.request(command, arguments).await
}

#[tauri::command]
pub async fn dap_status(
    state: State<'_, DapState>,
    session_id: String,
) -> Result<Option<DapSessionInfo>, String> {
    let session = state.sessions.lock().await.get(&session_id).cloned();
    Ok(match session {
        Some(session) => Some(session.info().await),
        None => None,
    })
}

#[tauri::command]
pub async fn dap_stop(state: State<'_, DapState>, session_id: String) -> Result<(), String> {
    if let Some(session) = state.sessions.lock().await.remove(&session_id) {
        session.stop().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn dap_stop_all(state: State<'_, DapState>) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .await
        .drain()
        .map(|(_, session)| session)
        .collect::<Vec<_>>();
    for session in sessions {
        session.stop().await;
    }
    Ok(())
}
