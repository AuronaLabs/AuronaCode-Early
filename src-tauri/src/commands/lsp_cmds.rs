use crate::lsp::{self, LanguageServerInfo};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

fn file_path_to_uri(path: &str) -> Result<String, String> {
    url::Url::from_file_path(Path::new(path))
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
}

impl LspState {
    pub fn new() -> Self {
        Self {
            clients: tokio::sync::Mutex::new(HashMap::new()),
            launches: tokio::sync::Mutex::new(HashMap::new()),
        }
    }
}

fn canonical_language(language: &str) -> &str {
    match language {
        "javascript" => "typescript",
        other => other,
    }
}

fn resolve_node_package_entry(
    workspace_root: Option<&str>,
    relative_entry: &[&str],
    server_name: &str,
) -> Result<PathBuf, String> {
    let mut roots = Vec::new();
    if let Some(root) = workspace_root {
        roots.push(PathBuf::from(root));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        if !roots.contains(&current_dir) {
            roots.push(current_dir);
        }
    }

    for root in &roots {
        let mut entry = root.join("node_modules");
        for segment in relative_entry {
            entry.push(segment);
        }
        if entry.is_file() {
            return Ok(entry);
        }
    }

    let searched = roots
        .iter()
        .map(|root| root.join("node_modules").display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "{server_name} is not installed. Searched: {searched}. Install the dependency or configure an explicit language server command."
    ))
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
) -> Result<LanguageServerLaunch, String> {
    let canonical = canonical_language(language).to_string();
    let (command, args) = if let Some(command) = options.command {
        (command, options.args)
    } else {
        match canonical.as_str() {
            "typescript" => {
                let cli = resolve_node_package_entry(
                    options.workspace_root.as_deref(),
                    &["typescript-language-server", "lib", "cli.mjs"],
                    "TypeScript Language Server",
                )?;
                (
                    "node".to_string(),
                    vec![cli.to_string_lossy().to_string(), "--stdio".to_string()],
                )
            }
            "rust" => ("rust-analyzer".to_string(), Vec::new()),
            "python" => {
                let cli = resolve_node_package_entry(
                    options.workspace_root.as_deref(),
                    &["pyright", "langserver.index.js"],
                    "Pyright Language Server",
                )?;
                (
                    "node".to_string(),
                    vec![cli.to_string_lossy().to_string(), "--stdio".to_string()],
                )
            }
            _ => return Err(format!("No language server is configured for {language}")),
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
        env: options.env,
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
    let launch = resolve_builtin_launch(&language, options.unwrap_or_default())?;
    start_launch(launch, app_handle, &state).await
}

#[tauri::command]
pub async fn lsp_stop(language: String, state: State<'_, LspState>) -> Result<(), String> {
    let client = state
        .clients
        .lock()
        .await
        .remove(canonical_language(&language));
    if let Some(client) = client {
        client.shutdown().await;
    }
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
        client
            .notify(
                "textDocument/didOpen",
                serde_json::json!({
                    "textDocument": {
                        "uri": file_path_to_uri(&path)?,
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
        client
            .notify(
                "textDocument/didChange",
                serde_json::json!({
                    "textDocument": {
                        "uri": file_path_to_uri(&path)?,
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
        let mut params = serde_json::json!({
            "textDocument": { "uri": file_path_to_uri(&path)? }
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
        client
            .notify(
                "textDocument/didClose",
                serde_json::json!({
                    "textDocument": { "uri": file_path_to_uri(&path)? }
                }),
            )
            .await?;
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

#[cfg(test)]
mod tests {
    use super::{canonical_language, file_path_to_uri};

    #[test]
    fn javascript_and_typescript_share_a_server() {
        assert_eq!(canonical_language("javascript"), "typescript");
        assert_eq!(canonical_language("typescript"), "typescript");
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
