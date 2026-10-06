use crate::commands::fs::WorkspaceState;
use crate::launch_registry::{LaunchRegistry, LaunchSpec};
use crate::lsp::{self, LanguageServerInfo};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tauri::State;

fn file_path_to_uri(path: &str) -> Result<String, String> {
    // url crate handles both Windows (drive letters, backslashes, UNC) and
    // POSIX paths natively; normalizing separators here would break Unix.
    let p = Path::new(path);
    url::Url::from_file_path(p)
        .map(|uri| uri.to_string())
        .map_err(|_| format!("Unable to convert file path to LSP URI: {path}"))
}

#[tauri::command]
pub fn lsp_file_uri(path: String) -> Result<String, String> {
    file_path_to_uri(&path)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerStartOptions {
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub initialization_options: serde_json::Value,
    #[serde(default)]
    pub settings: serde_json::Value,
    #[serde(default = "default_request_timeout_ms")]
    pub request_timeout_ms: u64,
}

fn default_request_timeout_ms() -> u64 {
    10_000
}

impl Default for LanguageServerStartOptions {
    fn default() -> Self {
        Self {
            workspace_root: None,
            command: None,
            args: Vec::new(),
            env: HashMap::new(),
            initialization_options: serde_json::Value::Null,
            settings: serde_json::json!({}),
            request_timeout_ms: default_request_timeout_ms(),
        }
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct LanguageServerLaunch {
    language: String,
    command: String,
    args: Vec<String>,
    workspace_root: Option<String>,
    env: HashMap<String, String>,
    initialization_options: serde_json::Value,
    settings: serde_json::Value,
    request_timeout_ms: u64,
    launch_id: String,
}

pub struct LspState {
    pub clients: tokio::sync::Mutex<HashMap<String, Arc<lsp::LspClient>>>,
    launches: tokio::sync::Mutex<HashMap<String, LanguageServerLaunch>>,
    opened_docs: tokio::sync::Mutex<HashMap<String, i32>>,
    lifecycle: tokio::sync::Mutex<()>,
}

impl LspState {
    pub fn new() -> Self {
        Self {
            clients: tokio::sync::Mutex::new(HashMap::new()),
            launches: tokio::sync::Mutex::new(HashMap::new()),
            opened_docs: tokio::sync::Mutex::new(HashMap::new()),
            lifecycle: tokio::sync::Mutex::new(()),
        }
    }
}

impl Default for LspState {
    fn default() -> Self {
        Self::new()
    }
}

fn canonical_language(language: &str) -> &str {
    match language {
        "javascript" => "typescript",
        other => other,
    }
}

fn resolve_workspace_node_package_entry(
    workspace_root: Option<&str>,
    relative_entry: &[&str],
) -> Option<PathBuf> {
    let root = workspace_root.map(PathBuf::from)?;
    let mut entry = root.join("node_modules");
    for segment in relative_entry {
        entry.push(segment);
    }
    entry.is_file().then_some(entry)
}

fn node_compatible_path(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    if let Some(absolute) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(absolute);
    }
    path.to_path_buf()
}

async fn get_client(state: &State<'_, LspState>, language: &str) -> Option<Arc<lsp::LspClient>> {
    state
        .clients
        .lock()
        .await
        .get(canonical_language(language))
        .cloned()
}

fn resolve_builtin_launch(
    language: &str,
    options: LanguageServerStartOptions,
    app_handle: &tauri::AppHandle,
) -> Result<LanguageServerLaunch, String> {
    let canonical = canonical_language(language).to_string();
    let environment = options.env.clone();
    let (command, args) = if let Some(command) = options.command {
        (command, options.args)
    } else {
        // 1. 优先检查当前工作区是否自带 LSP 依赖 (例如项目内 pnpm install typescript-language-server)
        let workspace_cli = match canonical.as_str() {
            "typescript" => resolve_workspace_node_package_entry(
                options.workspace_root.as_deref(),
                &["typescript-language-server", "lib", "cli.mjs"],
            ),
            "python" => resolve_workspace_node_package_entry(
                options.workspace_root.as_deref(),
                &["pyright", "langserver.index.js"],
            ),
            _ => None,
        };

        if let Some(cli) = workspace_cli {
            // 工作区已有 node_modules 依赖，优先使用共享 node 运行时或系统 node
            let runtime_bin = crate::toolchains::find_shared_node_runtime(app_handle)
                .map(|p| node_compatible_path(&p).to_string_lossy().to_string())
                .unwrap_or_else(|| "node".to_string());
            (
                runtime_bin,
                vec![cli.to_string_lossy().to_string(), "--stdio".to_string()],
            )
        } else if let Some((manifest, lsp_dir)) =
            crate::toolchains::find_installed_lsp_for_language(app_handle, &canonical)
        {
            // 2. 命中 APPDATA 中从 Marketplace 下载的官方/第三方 LSP 包
            if manifest.runtime.runtime_type == "node" {
                let runtime = crate::toolchains::find_shared_node_runtime(app_handle)
                    .ok_or_else(|| format!("NO_RUNTIME_INSTALLED:node:{}", manifest.id))?;

                let entry_path = lsp_dir.join(&manifest.runtime.entry);
                if !entry_path.is_file() {
                    return Err(format!("LSP 入口文件丢失: {}", entry_path.display()));
                }

                let entry_str = node_compatible_path(&entry_path)
                    .to_string_lossy()
                    .to_string();
                let mut cmd_args = vec![entry_str];

                let default_args = manifest
                    .command
                    .as_ref()
                    .map(|c| c.args.clone())
                    .unwrap_or_else(|| vec!["--stdio".to_string()]);
                cmd_args.extend(default_args);

                (
                    node_compatible_path(&runtime).to_string_lossy().to_string(),
                    cmd_args,
                )
            } else {
                // native 二进制运行模式
                let bin_path = lsp_dir.join(&manifest.runtime.entry);
                let default_args = manifest
                    .command
                    .as_ref()
                    .map(|c| c.args.clone())
                    .unwrap_or_default();
                (bin_path.to_string_lossy().to_string(), default_args)
            }
        } else {
            // 3. 本地未安装针对该语言的工具链，返回标准可机器识别的未安装状态
            match canonical.as_str() {
                "rust" => ("rust-analyzer".to_string(), Vec::new()),
                _ => return Err(format!("NO_LSP_INSTALLED:{canonical}")),
            }
        }
    };

    if command.trim().is_empty() {
        return Err("Language server command must not be empty".to_string());
    }

    Ok(LanguageServerLaunch {
        language: canonical,
        command,
        args,
        workspace_root: options.workspace_root,
        env: environment,
        initialization_options: options.initialization_options,
        settings: options.settings,
        request_timeout_ms: options.request_timeout_ms.clamp(1_000, 120_000),
        launch_id: String::new(),
    })
}

async fn start_launch(
    launch: LanguageServerLaunch,
    app_handle: tauri::AppHandle,
    state: &State<'_, LspState>,
) -> Result<(), String> {
    let workspace = app_handle.state::<WorkspaceState>();
    let generation = workspace.generation();
    let tool_use = crate::toolchains::acquire_launch_use(
        &app_handle,
        &launch.command,
        &launch.args,
        launch.workspace_root.as_deref().unwrap_or_default(),
    )?;
    app_handle
        .state::<LaunchRegistry>()
        .resolve(&workspace, &launch.launch_id, "lsp")?;
    let existing = state.clients.lock().await.get(&launch.language).cloned();
    if let Some(existing) = existing {
        if existing.generation() == generation {
            return Ok(());
        }
        state.clients.lock().await.remove(&launch.language);
        existing.shutdown().await;
        let prefix = format!("{}:", launch.language);
        state
            .opened_docs
            .lock()
            .await
            .retain(|key, _| !key.starts_with(&prefix));
    }

    let client = Arc::new(
        lsp::LspClient::start(
            launch.language.clone(),
            launch.command.clone(),
            launch.args.clone(),
            launch.workspace_root.clone(),
            launch.env.clone(),
            Duration::from_millis(launch.request_timeout_ms),
            app_handle.clone(),
            tool_use,
            generation,
        )
        .await?,
    );
    client.set_initializing().await;

    let root_uri = launch
        .workspace_root
        .as_deref()
        .map(file_path_to_uri)
        .transpose()?;
    let workspace_folders = match (&launch.workspace_root, &root_uri) {
        (Some(root), Some(uri)) => serde_json::json!([{
            "uri": uri,
            "name": Path::new(root)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Workspace")
        }]),
        _ => serde_json::Value::Null,
    };
    let version = app_handle.package_info().version.to_string();
    let initialize_result = match client
        .call(
            "initialize",
            serde_json::json!({
                "processId": std::process::id(),
                "clientInfo": { "name": "Aurona Code", "version": version },
                "rootUri": root_uri,
                "workspaceFolders": workspace_folders,
                "initializationOptions": launch.initialization_options,
                "capabilities": client_capabilities()
            }),
        )
        .await
    {
        Ok(value) => value,
        Err(error) => {
            client.shutdown().await;
            return Err(error);
        }
    };
    let capabilities = initialize_result
        .get("capabilities")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    client.set_initialized(capabilities).await;
    client.notify("initialized", serde_json::json!({})).await?;
    if !launch.settings.is_null() {
        client
            .notify(
                "workspace/didChangeConfiguration",
                serde_json::json!({ "settings": launch.settings }),
            )
            .await?;
    }

    if workspace.generation() != generation {
        client.shutdown().await;
        return Err("[workspace.generation] Workspace changed while starting LSP".into());
    }
    state
        .clients
        .lock()
        .await
        .insert(launch.language.clone(), Arc::clone(&client));
    state
        .launches
        .lock()
        .await
        .insert(launch.language.clone(), launch);
    Ok(())
}

fn client_capabilities() -> serde_json::Value {
    serde_json::json!({
        "general": {
            "positionEncodings": ["utf-16", "utf-8"]
        },
        "workspace": {
            "workspaceFolders": true,
            "configuration": true,
            "applyEdit": true,
            "workspaceEdit": {
                "documentChanges": true,
                "resourceOperations": []
            },
            "symbol": {}
        },
        "textDocument": {
            "synchronization": {
                "dynamicRegistration": false,
                "willSave": false,
                "willSaveWaitUntil": false,
                "didSave": true,
                "textDocumentSync": {
                    "openClose": true,
                    "change": 2
                }
            },
            "publishDiagnostics": {
                "relatedInformation": true,
                "versionSupport": true,
                "tagSupport": { "valueSet": [1, 2] }
            },
            "completion": {
                "completionItem": {
                    "snippetSupport": true,
                    "documentationFormat": ["markdown", "plaintext"],
                    "resolveSupport": {
                        "properties": ["documentation", "detail", "additionalTextEdits"]
                    }
                },
                "contextSupport": true
            },
            "hover": {
                "contentFormat": ["markdown", "plaintext"]
            },
            "definition": { "linkSupport": true },
            "references": {},
            "documentSymbol": {
                "hierarchicalDocumentSymbolSupport": true
            },
            "rename": { "prepareSupport": true },
            "formatting": {},
            "codeAction": {
                "codeActionLiteralSupport": {
                    "codeActionKind": {
                        "valueSet": ["", "quickfix", "refactor", "source"]
                    }
                },
                "resolveSupport": { "properties": ["edit", "command"] }
            }
        }
    })
}

#[tauri::command]
pub async fn lsp_prepare(
    language: String,
    options: Option<LanguageServerStartOptions>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let workspace = app_handle.state::<WorkspaceState>();
    let root = workspace
        .root()?
        .ok_or("[workspace.closed] Open a workspace before starting LSP")?;
    let mut options = options.unwrap_or_default();
    if let Some(requested) = options.workspace_root.as_deref() {
        if workspace.require_directory(requested)? != root {
            return Err("[workspace.boundary] LSP root must match the active workspace".into());
        }
    }
    options.workspace_root = Some(root.to_string_lossy().into_owned());
    let launch = resolve_builtin_launch(&language, options, &app_handle)?;
    crate::launch_registry::authorize(
        &app_handle,
        LaunchSpec {
            kind: "lsp".into(),
            command: launch.command.clone(),
            args: launch.args.clone(),
            cwd: launch
                .workspace_root
                .clone()
                .ok_or("[workspace.closed] Missing LSP workspace")?,
            env: launch.env.clone(),
            configuration: serde_json::to_value(&launch).map_err(|e| e.to_string())?,
        },
    )
    .await
}

#[tauri::command]
pub async fn lsp_start(
    launch_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, LspState>,
) -> Result<(), String> {
    let spec = app_handle.state::<LaunchRegistry>().resolve(
        &app_handle.state::<WorkspaceState>(),
        &launch_id,
        "lsp",
    )?;
    let mut launch: LanguageServerLaunch = serde_json::from_value(spec.configuration)
        .map_err(|_| "[launch.configuration] Invalid LSP launch")?;
    launch.command = spec.command;
    launch.args = spec.args;
    launch.env = spec.env;
    launch.workspace_root = Some(spec.cwd);
    launch.launch_id = launch_id;
    let _lifecycle = state.lifecycle.lock().await;
    start_launch(launch, app_handle, &state).await
}

#[tauri::command]
pub async fn lsp_stop(language: String, state: State<'_, LspState>) -> Result<(), String> {
    let _lifecycle = state.lifecycle.lock().await;
    let key = canonical_language(&language);
    let client = state.clients.lock().await.remove(key);
    if let Some(client) = client {
        client.shutdown().await;
    }
    let prefix = format!("{key}:");
    state
        .opened_docs
        .lock()
        .await
        .retain(|k, _| !k.starts_with(&prefix));
    Ok(())
}

#[tauri::command]
pub async fn lsp_restart(
    language: String,
    app_handle: tauri::AppHandle,
    state: State<'_, LspState>,
) -> Result<(), String> {
    let _lifecycle = state.lifecycle.lock().await;
    let key = canonical_language(&language).to_string();
    let launch = state
        .launches
        .lock()
        .await
        .get(&key)
        .cloned()
        .ok_or_else(|| format!("Language server {key} has no previous launch configuration"))?;
    if let Some(client) = state.clients.lock().await.remove(&key) {
        client.shutdown().await;
    }
    let prefix = format!("{key}:");
    state
        .opened_docs
        .lock()
        .await
        .retain(|k, _| !k.starts_with(&prefix));
    start_launch(launch, app_handle, &state).await
}

#[tauri::command]
pub async fn lsp_status(state: State<'_, LspState>) -> Result<Vec<LanguageServerInfo>, String> {
    let clients = state
        .clients
        .lock()
        .await
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let mut statuses = Vec::with_capacity(clients.len());
    for client in clients {
        statuses.push(client.info().await);
    }
    Ok(statuses)
}

#[tauri::command]
pub async fn lsp_stop_all(state: State<'_, LspState>) -> Result<(), String> {
    let _lifecycle = state.lifecycle.lock().await;
    state.opened_docs.lock().await.clear();
    let clients = state
        .clients
        .lock()
        .await
        .drain()
        .map(|(_, client)| client)
        .collect::<Vec<_>>();
    for client in clients {
        client.shutdown().await;
    }
    Ok(())
}

pub async fn stop_workspace_sessions(state: State<'_, LspState>, generation: u64) {
    let _lifecycle = state.lifecycle.lock().await;
    let mut clients = state.clients.lock().await;
    let keys = clients
        .iter()
        .filter(|(_, client)| client.generation() <= generation)
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    let removed = keys
        .iter()
        .filter_map(|key| clients.remove(key))
        .collect::<Vec<_>>();
    drop(clients);
    let mut docs = state.opened_docs.lock().await;
    let mut launches = state.launches.lock().await;
    for key in keys {
        launches.remove(&key);
        let prefix = format!("{key}:");
        docs.retain(|key, _| !key.starts_with(&prefix));
    }
    drop(docs);
    drop(launches);
    for client in removed {
        client.shutdown().await;
    }
}

#[tauri::command]
pub async fn lsp_did_open(
    language: String,
    path: String,
    text: String,
    version: i32,
    state: State<'_, LspState>,
    workspace: State<'_, WorkspaceState>,
) -> Result<(), String> {
    workspace.validate_path(&path, false)?;
    validate_document(&text, version)?;
    if let Some(client) = get_client(&state, &language).await {
        let uri = file_path_to_uri(&path)?;
        let doc_key = format!("{}:{}", canonical_language(&language), uri);
        let mut docs = state.opened_docs.lock().await;
        if docs.contains_key(&doc_key) {
            return Err(
                "[lsp.revision] Document is already open; resynchronize before opening".into(),
            );
        }

        client
            .notify(
                "textDocument/didOpen",
                serde_json::json!({
                    "textDocument": {
                        "uri": uri,
                        "languageId": language,
                        "version": version,
                        "text": text
                    }
                }),
            )
            .await?;
        docs.insert(doc_key, version);
    }
    Ok(())
}

/// LSP 位置（UTF-16 列，除非协商了其他编码）
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct LspPosition {
    pub line: u32,
    pub character: u32,
}

/// 增量变更的位置区间（基于修改前文本）
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct LspRange {
    pub start: LspPosition,
    pub end: LspPosition,
}

/// 单条内容变更：range 缺省时为全量替换
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct LspContentChange {
    pub range: Option<LspRange>,
    pub text: String,
}

#[tauri::command]
pub async fn lsp_did_change(
    language: String,
    path: String,
    text: String,
    version: i32,
    changes: Option<Vec<LspContentChange>>,
    state: State<'_, LspState>,
    workspace: State<'_, WorkspaceState>,
) -> Result<(), String> {
    workspace.validate_path(&path, false)?;
    validate_document(&text, version)?;
    if let Some(list) = &changes {
        if list.len() > 1024
            || list.iter().map(|change| change.text.len()).sum::<usize>() > 1024 * 1024
        {
            return Err("[lsp.resync_required] Incremental change exceeds limit; send a full resynchronization".into());
        }
    }
    if let Some(client) = get_client(&state, &language).await {
        let uri = file_path_to_uri(&path)?;
        let doc_key = format!("{}:{}", canonical_language(&language), uri);
        let mut docs = state.opened_docs.lock().await;
        let is_opened = docs.contains_key(&doc_key);
        if docs
            .get(&doc_key)
            .is_some_and(|previous| version <= *previous)
        {
            return Err(
                "[lsp.revision] Stale document revision; resynchronization required".into(),
            );
        }

        if !is_opened {
            // 如果尚未发送过 didOpen，先行发送一次以确保语言服务器初始化资源，避免 Unexpected resource 异常
            client
                .notify(
                    "textDocument/didOpen",
                    serde_json::json!({
                        "textDocument": {
                            "uri": uri,
                            "languageId": language,
                            "version": version,
                            "text": text
                        }
                    }),
                )
                .await?;
            docs.insert(doc_key, version);
            return Ok(());
        }

        // 增量变更优先；未提供（全量同步路径/旧调用方）时回退整文替换
        let content_changes = match changes {
            Some(list) if !list.is_empty() => serde_json::to_value(&list)
                .unwrap_or_else(|_| serde_json::json!([{ "text": text }])),
            _ => serde_json::json!([{ "text": text }]),
        };

        client
            .notify(
                "textDocument/didChange",
                serde_json::json!({
                    "textDocument": {
                        "uri": uri,
                        "version": version
                    },
                    "contentChanges": content_changes
                }),
            )
            .await?;
        docs.insert(doc_key, version);
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_save(
    language: String,
    path: String,
    text: Option<String>,
    state: State<'_, LspState>,
    workspace: State<'_, WorkspaceState>,
) -> Result<(), String> {
    workspace.validate_path(&path, true)?;
    if let Some(text) = &text {
        validate_document(text, 0)?;
    }
    if let Some(client) = get_client(&state, &language).await {
        let uri = file_path_to_uri(&path)?;
        let mut params = serde_json::json!({
            "textDocument": { "uri": uri }
        });
        if let Some(text) = text {
            params["text"] = serde_json::Value::String(text);
        }
        client.notify("textDocument/didSave", params).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_close(
    language: String,
    path: String,
    state: State<'_, LspState>,
) -> Result<(), String> {
    if let Some(client) = get_client(&state, &language).await {
        let uri = file_path_to_uri(&path)?;
        let doc_key = format!("{}:{}", canonical_language(&language), uri);
        let was_opened = state.opened_docs.lock().await.remove(&doc_key);

        // 仅当此前确已对该语言服务器发送过 didOpen 时，才向服务器派发 didClose，彻底避免 "Trying to close not opened document" 报错
        if was_opened.is_some() {
            let _ = client
                .notify(
                    "textDocument/didClose",
                    serde_json::json!({
                        "textDocument": { "uri": uri }
                    }),
                )
                .await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_call(
    language: String,
    method: String,
    params: serde_json::Value,
    state: State<'_, LspState>,
    workspace: State<'_, WorkspaceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state, &language)
        .await
        .ok_or_else(|| format!("Language server for {language} is not running"))?;
    validate_protocol_paths(&workspace, &params, 0)?;
    validate_method(&client.info().await.capabilities, &method)?;
    let generation = workspace.generation();
    let result = client.call(&method, params).await?;
    if workspace.generation() != generation {
        return Err("[workspace.generation] Workspace changed during LSP request".into());
    }
    validate_protocol_paths(&workspace, &result, 0)?;
    Ok(result)
}

#[tauri::command]
pub async fn lsp_call_with_id(
    language: String,
    id: u64,
    method: String,
    params: serde_json::Value,
    state: State<'_, LspState>,
    workspace: State<'_, WorkspaceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state, &language)
        .await
        .ok_or_else(|| format!("Language server for {language} is not running"))?;
    validate_protocol_paths(&workspace, &params, 0)?;
    validate_method(&client.info().await.capabilities, &method)?;
    let generation = workspace.generation();
    let result = client.call_with_id(id, &method, params).await?;
    if workspace.generation() != generation {
        return Err("[workspace.generation] Workspace changed during LSP request".into());
    }
    validate_protocol_paths(&workspace, &result, 0)?;
    Ok(result)
}

fn validate_document(text: &str, version: i32) -> Result<(), String> {
    if version < 0 || text.len() > 16 * 1024 * 1024 {
        return Err("[resource.limit] LSP document exceeds limit or has invalid revision".into());
    }
    Ok(())
}

pub(crate) fn validate_protocol_paths(
    workspace: &WorkspaceState,
    value: &serde_json::Value,
    depth: usize,
) -> Result<(), String> {
    if depth > 64 {
        return Err("[resource.limit] LSP value nesting exceeds limit".into());
    }
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                validate_protocol_paths(workspace, item, depth + 1)?;
            }
        }
        serde_json::Value::Object(items) => {
            for (key, item) in items {
                if key.starts_with("file:") {
                    validate_uri(workspace, key)?;
                }
                if matches!(key.as_str(), "uri" | "targetUri" | "oldUri" | "newUri") {
                    let uri = item
                        .as_str()
                        .ok_or("[lsp.uri] Document URI must be a string")?;
                    validate_uri(workspace, uri)?;
                }
                validate_protocol_paths(workspace, item, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_uri(workspace: &WorkspaceState, raw: &str) -> Result<(), String> {
    let path = url::Url::parse(raw)
        .map_err(|_| "[lsp.uri] Invalid document URI")?
        .to_file_path()
        .map_err(|_| "[lsp.uri] Only scoped file URIs are allowed")?;
    if workspace.contains(&path.to_string_lossy())? {
        workspace.validate_path(&path.to_string_lossy(), false)
    } else {
        workspace.file_access(&path.to_string_lossy()).map(|_| ())
    }
}

fn validate_method(capabilities: &serde_json::Value, method: &str) -> Result<(), String> {
    let capability = match method {
        "textDocument/completion" | "completionItem/resolve" => "completionProvider",
        "textDocument/hover" => "hoverProvider",
        "textDocument/definition" => "definitionProvider",
        "textDocument/declaration" => "declarationProvider",
        "textDocument/typeDefinition" => "typeDefinitionProvider",
        "textDocument/implementation" => "implementationProvider",
        "textDocument/references" => "referencesProvider",
        "textDocument/documentSymbol" => "documentSymbolProvider",
        "workspace/symbol" => "workspaceSymbolProvider",
        "textDocument/rename" | "textDocument/prepareRename" => "renameProvider",
        "textDocument/formatting" => "documentFormattingProvider",
        "textDocument/rangeFormatting" => "documentRangeFormattingProvider",
        "textDocument/codeAction" | "codeAction/resolve" => "codeActionProvider",
        "textDocument/signatureHelp" => "signatureHelpProvider",
        "textDocument/semanticTokens/full" | "textDocument/semanticTokens/range" => {
            "semanticTokensProvider"
        }
        "textDocument/foldingRange" => "foldingRangeProvider",
        "textDocument/inlayHint" | "inlayHint/resolve" => "inlayHintProvider",
        _ => return Err("[lsp.method] Method is not in the host allowlist".into()),
    };
    if !capabilities
        .get(capability)
        .is_some_and(|value| !value.is_null() && value != false)
    {
        return Err("[lsp.capability] Method was not negotiated with the server".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_cancel(
    language: String,
    id: u64,
    state: State<'_, LspState>,
) -> Result<(), String> {
    let client = get_client(&state, &language)
        .await
        .ok_or_else(|| format!("Language server for {language} is not running"))?;
    client.cancel(id).await
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageToolchainStatus {
    pub language: String,
    pub is_lsp_installed: bool,
    pub installed_lsp_id: Option<String>,
    pub installed_lsp_version: Option<String>,
    pub required_runtime_type: Option<String>,
    pub is_runtime_ready: bool,
}

#[tauri::command]
pub fn lsp_toolchain_status(app: tauri::AppHandle, language: String) -> LanguageToolchainStatus {
    let canonical = canonical_language(&language);
    let lsp_match = crate::toolchains::find_installed_lsp_for_language(&app, canonical);
    let (is_lsp_installed, installed_lsp_id, installed_lsp_version, req_runtime) = match &lsp_match
    {
        Some((m, _)) => (
            true,
            Some(m.id.clone()),
            Some(m.version.clone()),
            Some(m.runtime.runtime_type.clone()),
        ),
        None => (false, None, None, None),
    };

    let is_runtime_ready = match req_runtime.as_deref() {
        Some("node") => crate::toolchains::find_shared_node_runtime(&app).is_some(),
        Some("native") => true,
        _ => true,
    };

    LanguageToolchainStatus {
        language: canonical.to_string(),
        is_lsp_installed,
        installed_lsp_id,
        installed_lsp_version,
        required_runtime_type: req_runtime,
        is_runtime_ready,
    }
}

#[tauri::command]
pub async fn lsp_toolchain_install(
    app: tauri::AppHandle,
    artifact_id: String,
    task_id: Option<String>,
) -> Result<crate::toolchains::InstalledToolchainSummary, String> {
    crate::artifacts::install_toolchain(
        app,
        &artifact_id,
        &task_id.unwrap_or_else(|| format!("install-{:032x}", rand::random::<u128>())),
    )
    .await
}

#[tauri::command]
pub async fn lsp_toolchain_install_url(
    app: tauri::AppHandle,
    download_id: String,
    url: String,
    expected_sha256: Option<String>,
    expected_id: String,
    expected_version: Option<String>,
) -> Result<crate::artifacts::ArtifactHandle, String> {
    crate::toolchains::install_toolchain_from_url(
        app,
        download_id,
        url,
        expected_sha256,
        expected_id,
        expected_version,
    )
    .await
}

#[tauri::command]
pub fn lsp_toolchain_list(app: tauri::AppHandle) -> crate::toolchains::ToolchainsOverview {
    crate::toolchains::list_all_installed_toolchains(&app)
}

#[tauri::command]
pub async fn lsp_toolchain_uninstall(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::toolchains::uninstall_toolchain_server(&app, &id))
        .await
        .map_err(|e| format!("执行卸载任务失败: {e}"))?
}

#[tauri::command]
pub async fn lsp_toolchain_uninstall_runtime(
    app: tauri::AppHandle,
    runtime_type: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        crate::toolchains::uninstall_toolchain_runtime(&app, &runtime_type)
    })
    .await
    .map_err(|e| format!("执行卸载运行时任务失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::{canonical_language, file_path_to_uri};

    #[test]
    fn javascript_and_typescript_share_a_server() {
        assert_eq!(canonical_language("javascript"), "typescript");
        assert_eq!(canonical_language("typescript"), "typescript");
    }

    #[test]
    fn protocol_paths_check_nested_workspace_edits_and_explicit_external_files() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let workspace = crate::commands::fs::WorkspaceState::test_root(root.path());
        let inside = root.path().join("valid.ts");
        let external = outside.path().join("definition.ts");
        std::fs::write(&inside, "valid").unwrap();
        std::fs::write(&external, "external").unwrap();
        let inside_uri = file_path_to_uri(&inside.to_string_lossy()).unwrap();
        let outside_uri = file_path_to_uri(&external.to_string_lossy()).unwrap();
        let valid =
            serde_json::json!({"documentChanges":[{"textDocument":{"uri":inside_uri},"edits":[]}]});
        assert!(super::validate_protocol_paths(&workspace, &valid, 0).is_ok());
        let invalid = serde_json::json!({"changes":{outside_uri.clone():[]}});
        assert!(super::validate_protocol_paths(&workspace, &invalid, 0).is_err());
        assert!(super::validate_protocol_paths(
            &workspace,
            &serde_json::json!({"targetUri": outside_uri}),
            0
        )
        .is_err());
        for uri in [
            serde_json::json!(17),
            serde_json::json!("https://example.com/file"),
            serde_json::Value::Null,
        ] {
            assert!(
                super::validate_protocol_paths(&workspace, &serde_json::json!({"uri":uri}), 0)
                    .is_err()
            );
        }
        workspace
            .authorize_path(&external.to_string_lossy())
            .unwrap();
        assert!(super::validate_protocol_paths(&workspace, &invalid, 0).is_ok());
        let mut nested = valid;
        for _ in 0..65 {
            nested = serde_json::json!([nested]);
        }
        assert!(super::validate_protocol_paths(&workspace, &nested, 0).is_err());
    }

    #[test]
    fn generic_lsp_methods_require_an_explicit_negotiated_capability() {
        assert!(super::validate_method(&serde_json::json!({}), "textDocument/hover").is_err());
        assert!(super::validate_method(
            &serde_json::json!({"hoverProvider":false}),
            "textDocument/hover"
        )
        .is_err());
        assert!(super::validate_method(
            &serde_json::json!({"hoverProvider":true}),
            "textDocument/hover"
        )
        .is_ok());
        assert!(super::validate_method(
            &serde_json::json!({"executeCommandProvider":true}),
            "workspace/executeCommand"
        )
        .is_err());
    }

    #[test]
    fn document_limits_reject_oversize_and_negative_revisions() {
        assert!(super::validate_document("hello", -1).is_err());
        assert!(super::validate_document(&"x".repeat(16 * 1024 * 1024 + 1), 1).is_err());
        assert!(super::validate_document("hello", 1).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn node_paths_drop_windows_verbatim_prefixes() {
        use super::node_compatible_path;
        use std::path::Path;
        assert_eq!(
            node_compatible_path(Path::new(r"\\?\E:\Aurona Code\pyright\server.cjs")),
            Path::new(r"E:\Aurona Code\pyright\server.cjs")
        );
        assert_eq!(
            node_compatible_path(Path::new(r"\\?\UNC\server\share\server.cjs")),
            Path::new(r"\\server\share\server.cjs")
        );
    }

    #[cfg(unix)]
    #[test]
    fn unix_file_uri_encodes_reserved_and_unicode_characters() {
        let uri = file_path_to_uri("/tmp/Aurona 中文 #%.ts").expect("file URI");
        assert_eq!(uri, "file:///tmp/Aurona%20%E4%B8%AD%E6%96%87%20%23%25.ts");
    }

    #[cfg(windows)]
    #[test]
    fn windows_file_uri_supports_drive_and_unc_paths() {
        let drive = file_path_to_uri(r"C:\Aurona Code\中文 #%.ts").expect("drive URI");
        assert_eq!(
            drive,
            "file:///C:/Aurona%20Code/%E4%B8%AD%E6%96%87%20%23%25.ts"
        );
        let unc = file_path_to_uri(r"\\server\share\Aurona Code\main.ts").expect("UNC URI");
        assert_eq!(unc, "file://server/share/Aurona%20Code/main.ts");
    }
}
