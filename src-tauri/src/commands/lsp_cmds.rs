use crate::lsp::{self, LanguageServerInfo};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

fn file_path_to_uri(path: &str) -> Result<String, String> {
    let clean_path = path.replace('/', "\\");
    let p = Path::new(&clean_path);
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

#[derive(Clone)]
struct LanguageServerLaunch {
    language: String,
    command: String,
    args: Vec<String>,
    workspace_root: Option<String>,
    env: HashMap<String, String>,
    initialization_options: serde_json::Value,
    settings: serde_json::Value,
    request_timeout_ms: u64,
}

pub struct LspState {
    pub clients: tokio::sync::Mutex<HashMap<String, Arc<lsp::LspClient>>>,
    launches: tokio::sync::Mutex<HashMap<String, LanguageServerLaunch>>,
    opened_docs: tokio::sync::Mutex<std::collections::HashSet<String>>,
}

impl LspState {
    pub fn new() -> Self {
        Self {
            clients: tokio::sync::Mutex::new(HashMap::new()),
            launches: tokio::sync::Mutex::new(HashMap::new()),
            opened_docs: tokio::sync::Mutex::new(std::collections::HashSet::new()),
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
    })
}

async fn start_launch(
    launch: LanguageServerLaunch,
    app_handle: tauri::AppHandle,
    state: &State<'_, LspState>,
) -> Result<(), String> {
    if state.clients.lock().await.contains_key(&launch.language) {
        return Ok(());
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
    let initialize_result = client
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
        .await?;
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
                "didSave": true
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
pub async fn lsp_start(
    language: String,
    options: Option<LanguageServerStartOptions>,
    app_handle: tauri::AppHandle,
    state: State<'_, LspState>,
) -> Result<(), String> {
    let launch = resolve_builtin_launch(&language, options.unwrap_or_default(), &app_handle)?;
    start_launch(launch, app_handle, &state).await
}

#[tauri::command]
pub async fn lsp_stop(language: String, state: State<'_, LspState>) -> Result<(), String> {
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
        .retain(|k| !k.starts_with(&prefix));
    Ok(())
}

#[tauri::command]
pub async fn lsp_restart(
    language: String,
    app_handle: tauri::AppHandle,
    state: State<'_, LspState>,
) -> Result<(), String> {
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
        .retain(|k| !k.starts_with(&prefix));
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

#[tauri::command]
pub async fn lsp_did_open(
    language: String,
    path: String,
    text: String,
    version: i32,
    state: State<'_, LspState>,
) -> Result<(), String> {
    if let Some(client) = get_client(&state, &language).await {
        let uri = file_path_to_uri(&path)?;
        let doc_key = format!("{}:{}", canonical_language(&language), &uri);
        state.opened_docs.lock().await.insert(doc_key);

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
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_change(
    language: String,
    path: String,
    text: String,
    version: i32,
    state: State<'_, LspState>,
) -> Result<(), String> {
    if let Some(client) = get_client(&state, &language).await {
        let uri = file_path_to_uri(&path)?;
        let doc_key = format!("{}:{}", canonical_language(&language), &uri);
        let is_opened = state.opened_docs.lock().await.contains(&doc_key);

        if !is_opened {
            // 如果尚未发送过 didOpen，先行发送一次以确保语言服务器初始化资源，避免 Unexpected resource 异常
            state.opened_docs.lock().await.insert(doc_key);
            let _ = client
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
                .await;
            return Ok(());
        }

        client
            .notify(
                "textDocument/didChange",
                serde_json::json!({
                    "textDocument": {
                        "uri": uri,
                        "version": version
                    },
                    "contentChanges": [{ "text": text }]
                }),
            )
            .await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_save(
    language: String,
    path: String,
    text: Option<String>,
    state: State<'_, LspState>,
) -> Result<(), String> {
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
        let doc_key = format!("{}:{}", canonical_language(&language), &uri);
        let was_opened = state.opened_docs.lock().await.remove(&doc_key);

        // 仅当此前确已对该语言服务器发送过 didOpen 时，才向服务器派发 didClose，彻底避免 "Trying to close not opened document" 报错
        if was_opened {
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
) -> Result<serde_json::Value, String> {
    let client = get_client(&state, &language)
        .await
        .ok_or_else(|| format!("Language server for {language} is not running"))?;
    client.call(&method, params).await
}

#[tauri::command]
pub async fn lsp_call_with_id(
    language: String,
    id: u64,
    method: String,
    params: serde_json::Value,
    state: State<'_, LspState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state, &language)
        .await
        .ok_or_else(|| format!("Language server for {language} is not running"))?;
    client.call_with_id(id, &method, params).await
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
pub fn lsp_toolchain_install(
    app: tauri::AppHandle,
    archive_bytes: Vec<u8>,
    expected_sha256: Option<String>,
) -> Result<crate::toolchains::InstalledToolchainSummary, String> {
    crate::toolchains::install_toolchain_archive(&app, &archive_bytes, expected_sha256.as_deref())
}

#[tauri::command]
pub async fn lsp_toolchain_install_url(
    app: tauri::AppHandle,
    download_id: String,
    url: String,
    expected_sha256: Option<String>,
) -> Result<crate::toolchains::InstalledToolchainSummary, String> {
    crate::toolchains::install_toolchain_from_url(app, download_id, url, expected_sha256).await
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
