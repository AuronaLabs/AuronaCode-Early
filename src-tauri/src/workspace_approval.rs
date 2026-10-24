//! Workbench-owned workspace approval. No native dialog may appear during splash.
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct WorkspaceApprovals(Mutex<HashMap<String, oneshot::Sender<bool>>>);

pub async fn request(app: &tauri::AppHandle, path: &str) -> Result<bool, String> {
    let id = format!("workspace-{:032x}", rand::random::<u128>());
    let (sender, receiver) = oneshot::channel();
    let state = app.state::<WorkspaceApprovals>();
    state
        .0
        .lock()
        .map_err(|_| "[workspace.approval] Approval state unavailable")?
        .insert(id.clone(), sender);
    let emitted = app.emit_to(
        "main",
        "workspace:approval",
        serde_json::json!({ "id": id, "path": path }),
    );
    let approved = if emitted.is_ok() {
        matches!(
            tokio::time::timeout(Duration::from_secs(300), receiver).await,
            Ok(Ok(true))
        )
    } else {
        false
    };
    state
        .0
        .lock()
        .map_err(|_| "[workspace.approval] Approval state unavailable")?
        .remove(&id);
    let _ = app.emit_to("main", "workspace:approval-closed", &id);
    Ok(approved)
}

#[tauri::command]
pub fn workspace_resolve_approval(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WorkspaceApprovals>,
    id: String,
    approved: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("[workspace.approval] Main workbench required".into());
    }
    if let Some(sender) = state
        .0
        .lock()
        .map_err(|_| "[workspace.approval] Approval state unavailable")?
        .remove(&id)
    {
        let _ = sender.send(approved);
    }
    Ok(())
}
