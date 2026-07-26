use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::content_length::{encode_message, ContentLengthDecoder};
use crate::process_tree::ManagedChild;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LanguageServerStatus {
    Stopped,
    Starting,
    Initializing,
    Running,
    Restarting,
    Failed,
    Stopping,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerInfo {
    pub language: String,
    pub status: LanguageServerStatus,
    pub command: String,
    pub args: Vec<String>,
    pub workspace_root: Option<String>,
    pub capabilities: Value,
    pub position_encoding: String,
    pub started_at_ms: Option<u64>,
    pub process_id: Option<u32>,
    pub restart_count: u32,
    pub last_error: Option<String>,
}

#[derive(Debug)]
enum IncomingResponse {
    Message(Value),
    TransportClosed,
}

pub struct LspClient {
    id_counter: AtomicU64,
    writer_tx: mpsc::Sender<Vec<u8>>,
    response_waiters: Arc<Mutex<HashMap<u64, oneshot::Sender<IncomingResponse>>>>,
    child: std::sync::Mutex<Option<ManagedChild>>,
    tasks: std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>>,
    info: Arc<Mutex<LanguageServerInfo>>,
    request_timeout: Duration,
    app_handle: tauri::AppHandle,
}

impl Drop for LspClient {
    fn drop(&mut self) {
        if let Ok(tasks) = self.tasks.get_mut() {
            for task in tasks.drain(..) {
                task.abort();
            }
        }
        if let Ok(child) = self.child.get_mut() {
            if let Some(child) = child.as_mut() {
                child.terminate_now();
            }
        }
    }
}

impl LspClient {
    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        language: String,
        command: String,
        args: Vec<String>,
        workspace_root: Option<String>,
        environment: HashMap<String, String>,
        request_timeout: Duration,
        app_handle: tauri::AppHandle,
    ) -> Result<Self, String> {
        let info = Arc::new(Mutex::new(LanguageServerInfo {
            language: language.clone(),
            status: LanguageServerStatus::Starting,
            command: command.clone(),
            args: args.clone(),
            workspace_root: workspace_root.clone(),
            capabilities: json!({}),
            position_encoding: "utf-16".to_string(),
            started_at_ms: None,
            process_id: None,
            restart_count: 0,
            last_error: None,
        }));
        emit_state(&app_handle, &info).await;

        let mut process = Command::new(&command);
        process
            .args(&args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(root) = &workspace_root {
            process.current_dir(root);
        }
        for (key, value) in environment {
            process.env(key, value);
        }

        #[cfg(target_os = "windows")]
        {
            process.creation_flags(0x08000000);
        }

        let mut child = process.spawn().map_err(|error| {
            format!("Unable to start language server executable `{command}`: {error}")
        })?;
        let process_id = child.id();
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Language server stdin is unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Language server stdout is unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Language server stderr is unavailable".to_string())?;
        let managed_child = ManagedChild::attach(child)?;

        {
            let mut snapshot = info.lock().await;
            snapshot.process_id = process_id;
            snapshot.started_at_ms = Some(unix_time_ms());
        }
        emit_state(&app_handle, &info).await;

        let (writer_tx, mut writer_rx) = mpsc::channel::<Vec<u8>>(128);
        let response_waiters = Arc::new(Mutex::new(HashMap::<
            u64,
            oneshot::Sender<IncomingResponse>,
        >::new()));

        let writer_info = Arc::clone(&info);
        let writer_app = app_handle.clone();
        let writer_task = tokio::spawn(async move {
            while let Some(body) = writer_rx.recv().await {
                let framed = encode_message(&body);
                if let Err(error) = stdin.write_all(&framed).await {
                    mark_transport_failed(
                        &writer_app,
                        &writer_info,
                        format!("Language server stdin write failed: {error}"),
                    )
                    .await;
                    break;
                }
                if let Err(error) = stdin.flush().await {
                    mark_transport_failed(
                        &writer_app,
                        &writer_info,
                        format!("Language server stdin flush failed: {error}"),
                    )
                    .await;
                    break;
                }
            }
        });

        let reader_writer = writer_tx.clone();
        let reader_waiters = Arc::clone(&response_waiters);
        let reader_info = Arc::clone(&info);
        let reader_app = app_handle.clone();
        let reader_task = tokio::spawn(async move {
            let mut stdout = BufReader::new(stdout);
            let mut decoder = ContentLengthDecoder::default();
            let mut chunk = vec![0_u8; 8 * 1024];
            loop {
                let read = match stdout.read(&mut chunk).await {
                    Ok(0) => {
                        mark_transport_failed(
                            &reader_app,
                            &reader_info,
                            "Language server stdout closed".to_string(),
                        )
                        .await;
                        close_waiters(&reader_waiters).await;
                        return;
                    }
                    Ok(read) => read,
                    Err(error) => {
                        mark_transport_failed(
                            &reader_app,
                            &reader_info,
                            format!("Language server stdout read failed: {error}"),
                        )
                        .await;
                        close_waiters(&reader_waiters).await;
                        return;
                    }
                };
                decoder.push(&chunk[..read]);

                loop {
                    let body = match decoder.next_message() {
                        Ok(Some(body)) => body,
                        Ok(None) => break,
                        Err(error) => {
                            mark_transport_failed(
                                &reader_app,
                                &reader_info,
                                format!("Invalid language server frame: {error}"),
                            )
                            .await;
                            close_waiters(&reader_waiters).await;
                            return;
                        }
                    };
                    let message = match serde_json::from_slice::<Value>(&body) {
                        Ok(message) => message,
                        Err(error) => {
                            mark_transport_failed(
                                &reader_app,
                                &reader_info,
                                format!("Invalid language server JSON: {error}"),
                            )
                            .await;
                            close_waiters(&reader_waiters).await;
                            return;
                        }
                    };
                    route_message(&reader_app, &reader_writer, &reader_waiters, message).await;
                }
            }
        });

        let stderr_app = app_handle.clone();
        let stderr_language = language;
        let stderr_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = stderr_app.emit(
                    "lsp://log",
                    json!({
                        "language": stderr_language,
                        "level": "warn",
                        "source": "stderr",
                        "message": line
                    }),
                );
            }
        });

        Ok(Self {
            id_counter: AtomicU64::new(1),
            writer_tx,
            response_waiters,
            child: std::sync::Mutex::new(Some(managed_child)),
            tasks: std::sync::Mutex::new(vec![writer_task, reader_task, stderr_task]),
            info,
            request_timeout,
            app_handle,
        })
    }

    pub async fn set_initializing(&self) {
        self.set_status(LanguageServerStatus::Initializing, None)
            .await;
    }

    pub async fn set_initialized(&self, capabilities: Value) {
        {
            let mut info = self.info.lock().await;
            info.position_encoding = capabilities
                .get("positionEncoding")
                .and_then(Value::as_str)
                .unwrap_or("utf-16")
                .to_string();
            info.capabilities = capabilities;
            info.status = LanguageServerStatus::Running;
            info.last_error = None;
        }
        emit_state(&self.app_handle, &self.info).await;
    }

    pub async fn info(&self) -> LanguageServerInfo {
        self.info.lock().await.clone()
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.id_counter.fetch_add(1, Ordering::SeqCst);
        self.call_with_id(id, method, params).await
    }

    pub async fn call_with_id(
        &self,
        id: u64,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        let message = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let (sender, receiver) = oneshot::channel();
        self.response_waiters.lock().await.insert(id, sender);
        if self
            .writer_tx
            .send(message.to_string().into_bytes())
            .await
            .is_err()
        {
            self.response_waiters.lock().await.remove(&id);
            return Err("Language server writer is closed".to_string());
        }

        match tokio::time::timeout(self.request_timeout, receiver).await {
            Ok(Ok(IncomingResponse::Message(response))) => {
                if let Some(error) = response.get("error") {
                    return Err(format!(
                        "Language server request `{method}` failed: {error}"
                    ));
                }
                Ok(response.get("result").cloned().unwrap_or(Value::Null))
            }
            Ok(Ok(IncomingResponse::TransportClosed)) | Ok(Err(_)) => {
                self.response_waiters.lock().await.remove(&id);
                Err(format!(
                    "Language server transport closed while waiting for `{method}`"
                ))
            }
            Err(_) => {
                self.response_waiters.lock().await.remove(&id);
                let _ = self.cancel(id).await;
                Err(format!(
                    "Language server request `{method}` timed out after {} ms",
                    self.request_timeout.as_millis()
                ))
            }
        }
    }

    pub async fn cancel(&self, id: u64) -> Result<(), String> {
        self.response_waiters.lock().await.remove(&id);
        self.notify("$/cancelRequest", json!({ "id": id })).await
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let message = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        self.writer_tx
            .send(message.to_string().into_bytes())
            .await
            .map_err(|_| "Language server writer is closed".to_string())
    }

    pub async fn shutdown(&self) {
        self.set_status(LanguageServerStatus::Stopping, None).await;
        let _ =
            tokio::time::timeout(Duration::from_secs(2), self.call("shutdown", Value::Null)).await;
        let _ = self.notify("exit", Value::Null).await;

        if let Ok(mut tasks) = self.tasks.lock() {
            for task in tasks.drain(..) {
                task.abort();
            }
        }
        close_waiters(&self.response_waiters).await;

        let child = self.child.lock().ok().and_then(|mut child| child.take());
        if let Some(mut child) = child {
            child.wait_or_terminate(Duration::from_secs(1)).await;
        }
        self.set_status(LanguageServerStatus::Stopped, None).await;
    }

    async fn set_status(&self, status: LanguageServerStatus, error: Option<String>) {
        {
            let mut info = self.info.lock().await;
            info.status = status;
            if error.is_some() {
                info.last_error = error;
            }
        }
        emit_state(&self.app_handle, &self.info).await;
    }
}

async fn route_message(
    app: &tauri::AppHandle,
    writer: &mpsc::Sender<Vec<u8>>,
    waiters: &Arc<Mutex<HashMap<u64, oneshot::Sender<IncomingResponse>>>>,
    message: Value,
) {
    let id = message.get("id").and_then(Value::as_u64);
    let method = message.get("method").and_then(Value::as_str);
    match (id, method) {
        (Some(id), Some(method)) => {
            let result = match method {
                "workspace/configuration" => {
                    let count = message
                        .pointer("/params/items")
                        .and_then(Value::as_array)
                        .map_or(0, Vec::len);
                    json!({ "jsonrpc": "2.0", "id": id, "result": vec![Value::Null; count] })
                }
                "window/showMessageRequest"
                | "client/registerCapability"
                | "client/unregisterCapability" => {
                    json!({ "jsonrpc": "2.0", "id": id, "result": Value::Null })
                }
                _ => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": format!("Method not found: {method}") }
                }),
            };
            let _ = writer.send(result.to_string().into_bytes()).await;
        }
        (Some(id), None) => {
            if let Some(waiter) = waiters.lock().await.remove(&id) {
                let _ = waiter.send(IncomingResponse::Message(message));
            }
        }
        (None, Some("textDocument/publishDiagnostics")) => {
            let _ = app.emit("lsp://diagnostics", &message);
        }
        (None, Some("window/logMessage" | "window/showMessage")) => {
            let _ = app.emit(
                "lsp://log",
                json!({
                    "level": "info",
                    "source": "server",
                    "message": message.pointer("/params/message").and_then(Value::as_str).unwrap_or("")
                }),
            );
        }
        _ => {
            let _ = app.emit(
                "lsp://log",
                json!({
                    "level": "debug",
                    "source": "protocol",
                    "message": format!("Ignored language server message: {message}")
                }),
            );
        }
    }
}

async fn close_waiters(waiters: &Arc<Mutex<HashMap<u64, oneshot::Sender<IncomingResponse>>>>) {
    let mut waiters = waiters.lock().await;
    for (_, waiter) in waiters.drain() {
        let _ = waiter.send(IncomingResponse::TransportClosed);
    }
}

async fn emit_state(app: &tauri::AppHandle, info: &Arc<Mutex<LanguageServerInfo>>) {
    let snapshot = info.lock().await.clone();
    let _ = app.emit("lsp://state", snapshot);
}

async fn mark_transport_failed(
    app: &tauri::AppHandle,
    info: &Arc<Mutex<LanguageServerInfo>>,
    error: String,
) {
    let should_fail = {
        let mut snapshot = info.lock().await;
        if matches!(
            snapshot.status,
            LanguageServerStatus::Stopping | LanguageServerStatus::Stopped
        ) {
            false
        } else {
            snapshot.status = LanguageServerStatus::Failed;
            snapshot.last_error = Some(error.clone());
            true
        }
    };
    if should_fail {
        emit_state(app, info).await;
        let _ = app.emit(
            "lsp://log",
            json!({ "level": "error", "source": "transport", "message": error }),
        );
    }
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
