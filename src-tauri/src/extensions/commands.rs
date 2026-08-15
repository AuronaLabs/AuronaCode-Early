use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::registry::ExtensionDescriptor;
use super::runtime::{
    ContextEditorSnapshot, ContextEnvironment, ContextPermissionState, ExtensionContext,
};
use super::state::{workspace_identity, ExtensionState};
use crate::commands::fs::WorkspaceState;
use crate::editor::EditorState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionViewPayload {
    pub html: String,
    pub icon: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRenderRequest {
    pub extension_id: String,
    pub markdown: String,
    pub active_editor_path: Option<String>,
    pub theme: String,
    pub locale: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRenderResponse {
    pub html: String,
    pub diagnostics: Vec<String>,
    pub metrics: ExtensionRenderMetrics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRenderMetrics {
    pub package_open_ms: f64,
    pub wasm_compile_ms: f64,
    pub render_ms: f64,
}

fn permission_to_string(state: &ContextPermissionState) -> &'static str {
    match state {
        ContextPermissionState::Unknown => "unknown",
        ContextPermissionState::Granted => "granted",
        ContextPermissionState::Denied => "denied",
    }
}

#[tauri::command]
pub fn extensions_list(state: State<ExtensionState>) -> Vec<ExtensionDescriptor> {
    state.descriptors()
}

#[tauri::command]
pub fn extensions_get_view(
    state: State<ExtensionState>,
    extension_id: String,
) -> Result<ExtensionViewPayload, String> {
    let package = state
        .package(&extension_id)
        .ok_or_else(|| format!("扩展不存在: {extension_id}"))?;
    Ok(ExtensionViewPayload {
        html: package.view_html.clone(),
        icon: package.icon_svg.clone(),
    })
}

#[tauri::command]
pub fn extensions_get_permission(
    state: State<ExtensionState>,
    workspace: State<WorkspaceState>,
    extension_id: String,
    permission: String,
) -> Result<String, String> {
    let root = workspace.root()?;
    let identity = workspace_identity(root.as_deref());
    Ok(permission_to_string(&state.permission(&extension_id, &permission, &identity)).to_string())
}

#[tauri::command]
pub fn extensions_set_permission(
    state: State<ExtensionState>,
    workspace: State<WorkspaceState>,
    extension_id: String,
    permission: String,
    granted: bool,
) -> Result<String, String> {
    let root = workspace.root()?;
    let identity = workspace_identity(root.as_deref());
    let next = state.set_permission(&extension_id, &permission, &identity, granted);
    Ok(permission_to_string(&next).to_string())
}

#[tauri::command]
pub async fn extensions_render(
    state: State<'_, ExtensionState>,
    workspace: State<'_, WorkspaceState>,
    editor: State<'_, EditorState>,
    request: ExtensionRenderRequest,
) -> Result<ExtensionRenderResponse, String> {
    let root = workspace.root()?;
    let identity = workspace_identity(root.as_deref());

    let editor_permission =
        state.permission(&request.extension_id, "editor.current.read", &identity);
    let workspace_permission = state.permission(&request.extension_id, "workspace.read", &identity);
    if editor_permission == ContextPermissionState::Denied
        || workspace_permission == ContextPermissionState::Denied
    {
        return Err("扩展需要权限: 权限已被拒绝".to_string());
    }

    let mut context = ExtensionContext::new(
        root,
        ContextEnvironment {
            theme: request.theme.clone(),
            locale: request.locale.clone(),
        },
    );
    context.editor_permission = editor_permission;
    context.workspace_permission = workspace_permission;

    if editor_permission == ContextPermissionState::Granted {
        if let Some(path) = &request.active_editor_path {
            if let Some(session) = editor.sessions.get(path) {
                let document = session.snapshot.load();
                context.editor_snapshot = Some(ContextEditorSnapshot {
                    path: Some(path.clone()),
                    language: Some(session.language.clone()),
                    content: Some(document.content.to_string()),
                    version: document.version,
                });
            }
        }
    }

    let compile_started = Instant::now();
    let runtime = state.runtime_for(&request.extension_id)?;
    let wasm_compile_ms = compile_started.elapsed().as_secs_f64() * 1000.0;

    let render_started = Instant::now();
    // Defense in depth: without a grant, the WASM component never receives
    // editor content, even if a compromised frontend sends it.
    let markdown = if editor_permission == ContextPermissionState::Granted {
        request.markdown
    } else {
        String::new()
    };
    let output = tokio::task::spawn_blocking(move || runtime.render(context, markdown))
        .await
        .map_err(|error| format!("扩展渲染任务失败: {error}"))??;
    let render_ms = render_started.elapsed().as_secs_f64() * 1000.0;

    Ok(ExtensionRenderResponse {
        html: output.html,
        diagnostics: output.diagnostics,
        metrics: ExtensionRenderMetrics {
            package_open_ms: 0.0,
            wasm_compile_ms,
            render_ms,
        },
    })
}
