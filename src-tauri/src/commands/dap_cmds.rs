use crate::commands::fs::WorkspaceState;
use crate::dap::{DapLaunch, DapSession, DapSessionInfo};
use crate::launch_registry::{LaunchRegistry, LaunchSpec};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tauri::{AppHandle, State};

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
pub async fn dap_python_debugpy_status(
    app: AppHandle,
    launch_id: String,
) -> Result<PythonDebugpyStatus, String> {
    let (installed, version) = crate::python_tools::status(&app, &launch_id).await?;
    if installed {
        let version = version.unwrap_or_else(|| "unknown".into());
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
            "当前 Python 环境尚未安装 debugpy。Aurona 可以将 debugpy {} 安装到该环境",
            DEBUGPY_VERSION
        ),
    })
}

#[tauri::command]
pub async fn dap_install_python_debugpy(
    app: AppHandle,
    launch_id: String,
) -> Result<PythonDebugpyStatus, String> {
    crate::python_tools::install(&app, &launch_id).await?;
    dap_python_debugpy_status(app, launch_id).await
}

#[tauri::command]
pub async fn dap_start(
    app: AppHandle,
    state: State<'_, DapState>,
    launch_id: String,
) -> Result<DapSessionInfo, String> {
    let generation = app.state::<WorkspaceState>().generation();
    let spec =
        app.state::<LaunchRegistry>()
            .resolve(&app.state::<WorkspaceState>(), &launch_id, "dap")?;
    let tool_use =
        crate::toolchains::acquire_launch_use(&app, &spec.command, &spec.args, &spec.cwd)?;
    app.state::<LaunchRegistry>()
        .resolve(&app.state::<WorkspaceState>(), &launch_id, "dap")?;
    let launch = DapLaunch {
        session_id: spec
            .configuration
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or("[launch.configuration] Missing DAP session ID")?
            .to_string(),
        command: spec.command,
        args: spec.args,
        cwd: Some(spec.cwd),
        env: spec.env,
        request_timeout_ms: spec
            .configuration
            .get("requestTimeoutMs")
            .and_then(Value::as_u64),
    };
    let mut sessions = state.sessions.lock().await;
    if !sessions.contains_key(&launch.session_id)
        && sessions.len() >= crate::resource_limits::DAP_SESSIONS
    {
        return Err("[resource.limit] Debug session limit reached".into());
    }
    if let Some(existing) = sessions.remove(&launch.session_id) {
        existing.stop().await;
    }
    let session = DapSession::start(app.clone(), launch, tool_use, generation).await?;
    if app.state::<WorkspaceState>().generation() != generation {
        session.stop().await;
        return Err("[workspace.generation] Workspace changed while starting debugger".into());
    }
    let info = session.info().await;
    sessions.insert(info.session_id.clone(), session.clone());
    let session_id = info.session_id.clone();
    tokio::spawn(async move {
        session.wait_stopped().await;
        let state = app.state::<DapState>();
        let mut sessions = state.sessions.lock().await;
        if sessions
            .get(&session_id)
            .is_some_and(|current| Arc::ptr_eq(current, &session))
        {
            sessions.remove(&session_id);
        }
    });
    Ok(info)
}

#[tauri::command]
pub async fn dap_prepare(app: AppHandle, launch: DapLaunch) -> Result<String, String> {
    if launch.session_id.trim().is_empty() || launch.session_id.len() > 128 {
        return Err("[dap.session] Invalid session ID".into());
    }
    let cwd = app.state::<WorkspaceState>().require_directory(
        launch
            .cwd
            .as_deref()
            .ok_or("[workspace.boundary] DAP cwd requires an authorized directory")?,
    )?;
    crate::launch_registry::authorize(&app, LaunchSpec {
        kind: "dap".into(), command: launch.command, args: launch.args, cwd: cwd.to_string_lossy().into_owned(), env: launch.env,
        configuration: serde_json::json!({ "sessionId": launch.session_id, "requestTimeoutMs": launch.request_timeout_ms }),
    }).await
}

#[tauri::command]
pub async fn dap_request(
    app: AppHandle,
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
    if session.generation() != app.state::<WorkspaceState>().generation() {
        session.stop().await;
        return Err("[workspace.generation] Debug workspace changed".into());
    }
    session.request(command, arguments).await
}

#[tauri::command]
pub async fn dap_acknowledge_output(
    state: State<'_, DapState>,
    session_id: String,
    instance_id: String,
    seq: u64,
) -> Result<(), String> {
    let session = state.sessions.lock().await.get(&session_id).cloned();
    if let Some(session) = session {
        session.acknowledge_output(&instance_id, seq).await;
    }
    Ok(())
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

pub async fn stop_workspace_sessions(state: State<'_, DapState>, generation: u64) {
    let mut sessions = state.sessions.lock().await;
    let ids = sessions
        .iter()
        .filter(|(_, session)| session.generation() <= generation)
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    let removed = ids
        .iter()
        .filter_map(|id| sessions.remove(id))
        .collect::<Vec<_>>();
    drop(sessions);
    for session in removed {
        session.stop().await;
    }
}
