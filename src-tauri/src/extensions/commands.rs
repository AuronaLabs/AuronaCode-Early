use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use super::permissions::{PermissionLevel, PermissionScope};
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
    /// 活动编辑器的选中文本（前端在已授权读取时随请求携带）。
    #[serde(default)]
    pub selection_text: Option<String>,
    pub theme: String,
    pub accent_color: Option<String>,
    pub color_scheme: Option<String>,
    pub locale: String,
    pub font_weight: Option<String>,
    pub font_size: Option<String>,
}

/// 交互请求：与渲染请求共享环境字段，`payload` 是扩展自定义的不透明数据。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionActionRequest {
    pub extension_id: String,
    pub action_id: String,
    pub payload: String,
    pub active_editor_path: Option<String>,
    #[serde(default)]
    pub selection_text: Option<String>,
    pub theme: String,
    pub accent_color: Option<String>,
    pub color_scheme: Option<String>,
    pub locale: String,
    pub font_weight: Option<String>,
    pub font_size: Option<String>,
}

/// 渲染与交互共用的环境字段（`ExtensionContext` 构建输入）。
struct ExtensionViewInputs {
    extension_id: String,
    active_editor_path: Option<String>,
    selection_text: Option<String>,
    theme: String,
    accent_color: Option<String>,
    color_scheme: Option<String>,
    locale: String,
    font_weight: Option<String>,
    font_size: Option<String>,
}

impl ExtensionViewInputs {
    fn from_render(request: &ExtensionRenderRequest) -> Self {
        Self {
            extension_id: request.extension_id.clone(),
            active_editor_path: request.active_editor_path.clone(),
            selection_text: request.selection_text.clone(),
            theme: request.theme.clone(),
            accent_color: request.accent_color.clone(),
            color_scheme: request.color_scheme.clone(),
            locale: request.locale.clone(),
            font_weight: request.font_weight.clone(),
            font_size: request.font_size.clone(),
        }
    }

    fn from_action(request: &ExtensionActionRequest) -> Self {
        Self {
            extension_id: request.extension_id.clone(),
            active_editor_path: request.active_editor_path.clone(),
            selection_text: request.selection_text.clone(),
            theme: request.theme.clone(),
            accent_color: request.accent_color.clone(),
            color_scheme: request.color_scheme.clone(),
            locale: request.locale.clone(),
            font_weight: request.font_weight.clone(),
            font_size: request.font_size.clone(),
        }
    }
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
pub fn extensions_list(
    app: tauri::AppHandle,
    state: State<ExtensionState>,
) -> Vec<ExtensionDescriptor> {
    state.scan_extensions(&app);
    state.descriptors()
}

/// 扩展系统诊断：包加载失败列表、最近运行时失败与已安装清单。
/// 用于「兼容层未就绪」「扩展无法启动」等问题的可视化排查（0.4.6）。
#[tauri::command]
pub fn extensions_get_diagnostics(
    state: State<ExtensionState>,
) -> super::registry::RegistryDiagnostics {
    state.diagnostics()
}

/// 宿主请求-响应桥的前端应答回填（对话框/剪贴板/命令，0.4.6）。
#[tauri::command]
pub fn extensions_host_response(request_id: String, value: String) -> bool {
    super::runtime::host_bridge_respond(&request_id, value)
}

/// 前端向扩展事件队列推送一条事件（文档变更等），扩展经 poll-events 拉取。
#[tauri::command]
pub fn extensions_push_event(extension_id: String, event: String) {
    super::runtime::push_host_event(&extension_id, event);
}

#[tauri::command]
pub fn extensions_install(
    app: tauri::AppHandle,
    state: State<ExtensionState>,
    archive_bytes: Vec<u8>,
    expected_sha256: Option<String>,
) -> Result<ExtensionDescriptor, String> {
    state.install_package(&app, &archive_bytes, expected_sha256.as_deref())
}

/// 安装本地 .vsix 插件（规划 §5.5：设置页「安装本地 VSCode 插件」入口）。
#[tauri::command]
pub fn extensions_install_vscode(
    app: tauri::AppHandle,
    state: State<ExtensionState>,
    path: String,
) -> Result<ExtensionDescriptor, String> {
    let file_path = std::path::PathBuf::from(&path);
    if !file_path.is_file() {
        return Err(format!("文件不存在: {path}"));
    }
    if file_path
        .extension()
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("vsix"))
    {
        return Err("请选择 .vsix 插件包文件".to_string());
    }
    let bytes = std::fs::read(&file_path).map_err(|error| format!("读取 .vsix 失败: {error}"))?;
    if bytes.len() as u64 > super::aurx::MAX_ARCHIVE_BYTES {
        return Err(format!("VSIX 包超过大小上限: {} bytes", bytes.len()));
    }
    state.install_vsix_package(&app, &bytes)
}

/// 安装内置默认测试插件（vscode-demo.vsix，规划 §5.7：随包内置，经设置页一键装载）。
#[tauri::command]
pub fn extensions_install_default_vscode(
    app: tauri::AppHandle,
    state: State<ExtensionState>,
) -> Result<ExtensionDescriptor, String> {
    const DEMO_FILE: &str = "vscode-demo.vsix";
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    #[cfg(debug_assertions)]
    candidates.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("extensions-demo")
            .join(DEMO_FILE),
    );
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("extensions-demo").join(DEMO_FILE));
        candidates.push(
            resource_dir
                .join("resources")
                .join("extensions-demo")
                .join(DEMO_FILE),
        );
    }
    let demo_path = candidates
        .iter()
        .find(|path| path.is_file())
        .ok_or_else(|| format!("内置测试插件包缺失: {DEMO_FILE}"))?;
    let bytes =
        std::fs::read(demo_path).map_err(|error| format!("读取内置测试插件失败: {error}"))?;
    state.install_vsix_package(&app, &bytes)
}

#[tauri::command]
pub fn extensions_uninstall(
    app: tauri::AppHandle,
    state: State<ExtensionState>,
    extension_id: String,
) -> Result<(), String> {
    state.uninstall_package(&app, &extension_id)
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

/// 权限状态 + 生效作用域。设置页矩阵显示"作用域"就靠它。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPermissionDetail {
    pub state: String,
    /// "global" / "workspace" / "once" / "unknown"
    pub scope: String,
}

#[tauri::command]
pub fn extensions_get_permission(
    state: State<ExtensionState>,
    workspace: State<WorkspaceState>,
    extension_id: String,
    permission: String,
) -> Result<ExtensionPermissionDetail, String> {
    let root = workspace.root()?;
    let identity = workspace_identity(root.as_deref());
    let scope = state.permission_scope(&extension_id, &permission, &identity);
    let current = state.permission(&extension_id, &permission, &identity);
    // 有作用域记录但状态是 unknown 的场景不会出现（记录本身就是决定），保持一致即可
    Ok(ExtensionPermissionDetail {
        state: permission_to_string(&current).to_string(),
        scope: scope.to_string(),
    })
}

#[tauri::command]
/// `scope`: "workspace"（缺省，兼容旧调用方）/ "global" / "once"
pub fn extensions_set_permission(
    state: State<ExtensionState>,
    workspace: State<WorkspaceState>,
    extension_id: String,
    permission: String,
    granted: bool,
    scope: Option<String>,
) -> Result<String, String> {
    let resolved = match scope.as_deref() {
        Some("global") => PermissionScope::Global,
        Some("once") => PermissionScope::Once,
        _ => PermissionScope::Workspace,
    };
    // 全局授权不依赖工作区，即使当前没打开工作区也应可用
    let identity = match resolved {
        PermissionScope::Global => None,
        _ => Some(workspace_identity(workspace.root()?.as_deref())),
    };
    let next = state.set_permission(
        &extension_id,
        &permission,
        identity.as_deref(),
        granted,
        resolved,
    )?;
    Ok(permission_to_string(&next).to_string())
}

/// 撤销授权（恢复为 unknown，下次使用重新询问）。`permission` 省略时撤销该扩展全部权限。
#[tauri::command]
pub fn extensions_revoke_permission(
    state: State<ExtensionState>,
    extension_id: String,
    permission: Option<String>,
) -> Result<usize, String> {
    state.revoke_permission(&extension_id, permission.as_deref())
}

/// 权限目录。前端不维护自己的权限表，一律从这里拉取。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPermissionCatalogEntry {
    pub id: String,
    pub level: String,
    pub title_key: String,
    pub description_key: String,
    pub available: bool,
}

#[tauri::command]
pub fn extensions_permission_catalog() -> Vec<ExtensionPermissionCatalogEntry> {
    super::permissions::PERMISSIONS
        .iter()
        .map(|entry| ExtensionPermissionCatalogEntry {
            id: entry.id.to_string(),
            level: match entry.level {
                PermissionLevel::Normal => "normal",
                PermissionLevel::Sensitive => "sensitive",
                PermissionLevel::Critical => "critical",
            }
            .to_string(),
            title_key: entry.title_key.to_string(),
            description_key: entry.description_key.to_string(),
            available: entry.available,
        })
        .collect()
}

#[tauri::command]
pub fn extensions_set_session_permission(
    state: State<ExtensionState>,
    workspace: State<WorkspaceState>,
    extension_id: String,
    permission: String,
    granted: bool,
) -> Result<String, String> {
    let root = workspace.root()?;
    let identity = workspace_identity(root.as_deref());
    let next = state.set_session_permission(&extension_id, &permission, &identity, granted);
    Ok(permission_to_string(&next).to_string())
}

/// 渲染与交互共享的上下文构建：权限快照、环境元数据与编辑器内容注入。
/// 返回 (context, editor_read, workspace_read)，调用方再执行各自的调用与计量。
fn build_extension_context(
    app: &tauri::AppHandle,
    state: &ExtensionState,
    workspace: &WorkspaceState,
    editor: &EditorState,
    request: &ExtensionViewInputs,
) -> Result<
    (
        ExtensionContext,
        ContextPermissionState,
        ContextPermissionState,
    ),
    String,
> {
    let root = workspace.root()?;
    let identity = workspace_identity(root.as_deref());

    // 依据权限目录为每个"已开放"的权限取一次生效状态，填充组件侧快照。
    // 未开放的权限不进快照：组件侧 require() 会给出"尚未开放"的明确错误，
    // 让扩展能区分"被拒绝"与"当前版本没有这个能力"。
    let mut permissions = HashMap::new();
    for entry in super::permissions::PERMISSIONS
        .iter()
        .filter(|e| e.available)
    {
        permissions.insert(
            entry.id.to_string(),
            state.permission(&request.extension_id, entry.id, &identity),
        );
    }
    let editor_read = permissions
        .get("editor.current.read")
        .copied()
        .unwrap_or(ContextPermissionState::Unknown);
    let workspace_read = permissions
        .get("workspace.read")
        .copied()
        .unwrap_or(ContextPermissionState::Unknown);
    if editor_read == ContextPermissionState::Denied {
        return Err(
            "[permission.denied:editor.current.read] 当前文档读取权限已被用户拒绝".to_string(),
        );
    }
    if workspace_read == ContextPermissionState::Denied {
        return Err("[permission.denied:workspace.read] 工作区读取权限已被用户拒绝".to_string());
    }

    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    };

    let mut context = ExtensionContext::new(
        root,
        ContextEnvironment {
            theme: request.theme.clone(),
            accent_color: request
                .accent_color
                .clone()
                .unwrap_or_else(|| "aurora".to_string()),
            color_scheme: request.color_scheme.clone().unwrap_or_else(|| {
                if request.theme == "dark" {
                    "dark".to_string()
                } else {
                    "light".to_string()
                }
            }),
            locale: request.locale.clone(),
            font_weight: request
                .font_weight
                .clone()
                .unwrap_or_else(|| "normal".to_string()),
            font_size: request
                .font_size
                .clone()
                .unwrap_or_else(|| "default".to_string()),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            platform: platform.to_string(),
        },
    );
    context.extension_id = request.extension_id.clone();
    context.data_dir = app.path().app_local_data_dir().ok();
    context.permissions = permissions;
    // 宿主句柄：host 函数用它把编辑器写入 / Fliuno 贡献等请求回传前端。
    context.app = Some(app.clone());

    if editor_read == ContextPermissionState::Granted {
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
        // 选区文本由前端随请求携带；未授权读取时一律丢弃。
        context.editor_selection_text = request.selection_text.clone();
    }

    Ok((context, editor_read, workspace_read))
}

#[tauri::command]
pub async fn extensions_render(
    app: tauri::AppHandle,
    state: State<'_, ExtensionState>,
    workspace: State<'_, WorkspaceState>,
    editor: State<'_, EditorState>,
    request: ExtensionRenderRequest,
) -> Result<ExtensionRenderResponse, String> {
    let inputs = ExtensionViewInputs::from_render(&request);
    let (context, editor_read, _workspace_read) =
        build_extension_context(&app, &state, &workspace, &editor, &inputs)?;

    let compile_started = Instant::now();
    let runtime = state.runtime_for(&request.extension_id)?;
    let wasm_compile_ms = compile_started.elapsed().as_secs_f64() * 1000.0;

    let render_started = Instant::now();
    // VSCode 兼容包（.vsix 路径 2）：render 输入不是编辑器文档，而是包内的
    // 主入口 JS 源码——由兼容运行时（boa）在 guest 内真实执行。
    // 源码来自用户已安装的扩展包本身，不走 editor.read 授权门。
    let markdown = match state.package(&request.extension_id) {
        Some(pkg) if !pkg.js_source.is_empty() => pkg.js_source.clone(),
        _ if editor_read == ContextPermissionState::Granted => request.markdown,
        // Defense in depth: without a grant, the WASM component never receives
        // editor content, even if a compromised frontend sends it.
        _ => String::new(),
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

#[tauri::command]
pub async fn extensions_on_action(
    app: tauri::AppHandle,
    state: State<'_, ExtensionState>,
    workspace: State<'_, WorkspaceState>,
    editor: State<'_, EditorState>,
    request: ExtensionActionRequest,
) -> Result<ExtensionRenderResponse, String> {
    let inputs = ExtensionViewInputs::from_action(&request);
    let (context, _editor_read, _workspace_read) =
        build_extension_context(&app, &state, &workspace, &editor, &inputs)?;

    let compile_started = Instant::now();
    let runtime = state.runtime_for(&request.extension_id)?;
    let wasm_compile_ms = compile_started.elapsed().as_secs_f64() * 1000.0;

    let action_started = Instant::now();
    // VSCode 兼容包：组件跨调用无状态，on-action 时必须重新执行 JS。
    // WIT 契约保持不变——host 把 payload 覆盖为主入口 JS 源码，
    // action-id 语义不变（compat 运行时只服务 vscode 路径 2 扩展）。
    let payload = match state.package(&request.extension_id) {
        Some(pkg) if !pkg.js_source.is_empty() => pkg.js_source.clone(),
        _ => request.payload,
    };
    let output =
        tokio::task::spawn_blocking(move || runtime.on_action(context, request.action_id, payload))
            .await
            .map_err(|error| format!("扩展交互任务失败: {error}"))??;
    let action_ms = action_started.elapsed().as_secs_f64() * 1000.0;

    Ok(ExtensionRenderResponse {
        html: output.html,
        diagnostics: output.diagnostics,
        metrics: ExtensionRenderMetrics {
            package_open_ms: 0.0,
            wasm_compile_ms,
            render_ms: action_ms,
        },
    })
}
