use crate::lsp;
use tauri::State;

pub struct LspState {
    pub clients:
        tokio::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<lsp::LspClient>>>,
}

async fn get_client(
    state: &State<'_, LspState>,
    language: &str,
) -> Option<std::sync::Arc<lsp::LspClient>> {
    state.clients.lock().await.get(language).cloned()
}

#[tauri::command]
pub async fn lsp_start(
    language: String,
    app_handle: tauri::AppHandle,
    state: State<'_, LspState>,
) -> Result<(), String> {
    {
        let clients = state.clients.lock().await;
        if clients.contains_key(&language) {
            return Ok(()); // Already running
        }
    }

    let version = app_handle.package_info().version.to_string();

    #[cfg(target_os = "windows")]
    let (command, args_ref) = match language.as_str() {
        "typescript" | "javascript" => (
            "cmd.exe",
            vec!["/c", "npx", "typescript-language-server", "--stdio"],
        ),
        "python" => (
            "cmd.exe",
            vec![
                "/c",
                "npx",
                "--yes",
                "--package",
                "pyright",
                "pyright-langserver",
                "--stdio",
            ],
        ),
        "rust" => ("rust-analyzer", vec![]),
        _ => return Err(format!("Unsupported language: {}", language)),
    };

    #[cfg(not(target_os = "windows"))]
    let (command, args_ref) = match language.as_str() {
        "typescript" | "javascript" => ("npx", vec!["typescript-language-server", "--stdio"]),
        "python" => (
            "npx",
            vec![
                "--yes",
                "--package",
                "pyright",
                "pyright-langserver",
                "--stdio",
            ],
        ),
        "rust" => ("rust-analyzer", vec![]),
        _ => return Err(format!("Unsupported language: {}", language)),
    };

    let client = lsp::LspClient::start(command, &args_ref, app_handle.clone()).await?;

    let init_params = serde_json::json!({
        "processId": std::process::id(),
        "clientInfo": { "name": "Aurona Code", "version": version },
        "rootUri": null,
        "capabilities": {
            "textDocument": {
                "hover": {
                    "dynamicRegistration": true,
                    "contentFormat": ["markdown", "plaintext"]
                },
                "synchronization": {
                    "dynamicRegistration": true,
                    "willSave": false,
                    "willSaveWaitUntil": false,
                    "didSave": true
                }
            }
        }
    });

    let _ = client.call("initialize", init_params).await?;
    client.notify("initialized", serde_json::json!({})).await?;

    let mut clients = state.clients.lock().await;
    clients
        .entry(language)
        .or_insert_with(|| std::sync::Arc::new(client));
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
        let uri = format!("file:///{}", path.replace('\\', "/"));
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "languageId": language,
                "version": version,
                "text": text
            }
        });
        client.notify("textDocument/didOpen", params).await?;
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
        let uri = format!("file:///{}", path.replace('\\', "/"));
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "version": version
            },
            "contentChanges": [{
                "text": text
            }]
        });
        client.notify("textDocument/didChange", params).await?;
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
        let uri = format!("file:///{}", path.replace('\\', "/"));
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
            }
        });
        client.notify("textDocument/didClose", params).await?;
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
    if let Some(client) = get_client(&state, &language).await {
        let res = client.call(&method, params).await?;
        Ok(res)
    } else {
        Err(format!("LSP server for {} not running", language))
    }
}

#[tauri::command]
pub async fn lsp_call_with_id(
    language: String,
    id: u64,
    method: String,
    params: serde_json::Value,
    state: State<'_, LspState>,
) -> Result<serde_json::Value, String> {
    if let Some(client) = get_client(&state, &language).await {
        let res = client.call_with_id(id, &method, params).await?;
        Ok(res)
    } else {
        Err(format!("LSP server for {} not running", language))
    }
}

#[tauri::command]
pub async fn lsp_cancel(
    language: String,
    id: u64,
    state: State<'_, LspState>,
) -> Result<(), String> {
    if let Some(client) = get_client(&state, &language).await {
        client.cancel(id).await
    } else {
        Err(format!("LSP server for {} not running", language))
    }
}
