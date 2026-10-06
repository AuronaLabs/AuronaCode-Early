use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::content_length::{encode_message, ContentLengthDecoder};
use crate::process_service::ManagedChild;

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
    pub workspace_generation: u64,
    pub server_generation: String,
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
    active: Arc<AtomicBool>,
    workspace_generation: u64,
    tool_use: std::sync::Mutex<Option<crate::toolchains::ToolUseLease>>,
}

struct PendingGuard {
    id: u64,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<IncomingResponse>>>>,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.pending.try_lock() {
            pending.remove(&self.id);
            return;
        }
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let pending = self.pending.clone();
            let id = self.id;
            runtime.spawn(async move {
                pending.lock().await.remove(&id);
            });
        }
    }
}

impl Drop for LspClient {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
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
        tool_use: crate::toolchains::ToolUseLease,
        workspace_generation: u64,
    ) -> Result<Self, String> {
        if app_handle
            .state::<crate::commands::fs::WorkspaceState>()
            .generation()
            != workspace_generation
        {
            return Err("[workspace.generation] Language server authorization expired".into());
        }
        let active = Arc::new(AtomicBool::new(true));
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
            workspace_generation,
            server_generation: format!("lsp-{:032x}", rand::random::<u128>()),
        }));
        emit_state(&app_handle, &info).await;
        let _ = app_handle.emit(
            "lsp://log",
            json!({
                "language": language,
                "level": "info",
                "source": "process",
                "message": crate::redaction::redact(&format!("Starting executable `{command}`"))
            }),
        );

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
        ManagedChild::configure(&mut process);

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
        let reader_active = active.clone();
        let reader_task = tokio::spawn(async move {
            let mut stdout = BufReader::new(stdout);
            let mut decoder = ContentLengthDecoder::default();
            let mut chunk = vec![0_u8; 8 * 1024];
            let mut log_budget = LogBudget::default();
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
                    if reader_app
                        .state::<crate::commands::fs::WorkspaceState>()
                        .generation()
                        != workspace_generation
                    {
                        close_waiters(&reader_waiters).await;
                        return;
                    }
                    if !reader_active.load(Ordering::Acquire)
                        && (message.get("method").is_some() || message.get("id").is_none())
                    {
                        continue;
                    }
                    route_message(
                        &reader_app,
                        &reader_writer,
                        &reader_waiters,
                        message,
                        &mut log_budget,
                    )
                    .await;
                }
            }
        });

        let stderr_app = app_handle.clone();
        let stderr_language = language;
        let stderr_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr);
            while let Ok(Some(line)) = bounded_log_line(&mut lines).await {
                let _ = stderr_app.emit(
                    "lsp://log",
                    json!({
                        "language": stderr_language,
                        "level": "warn",
                        "source": "stderr",
                        "message": crate::redaction::redact(&line)
                    }),
                );
                tokio::time::sleep(Duration::from_millis(10)).await;
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
            active,
            workspace_generation,
            tool_use: std::sync::Mutex::new(Some(tool_use)),
        })
    }

    pub fn generation(&self) -> u64 {
        self.workspace_generation
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
        if method != "shutdown"
            && (!self.active.load(Ordering::Acquire)
                || self
                    .app_handle
                    .state::<crate::commands::fs::WorkspaceState>()
                    .generation()
                    != self.workspace_generation)
        {
            return Err(
                "[lsp.generation] Language server is no longer active in this workspace".into(),
            );
        }
        if method.is_empty()
            || method.len() > 128
            || serde_json::to_vec(&params)
                .map_err(|e| e.to_string())?
                .len()
                > crate::resource_limits::LSP_DOCUMENT_BYTES
        {
            return Err("[resource.limit] Language server request is too large".into());
        }
        let message = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.response_waiters.lock().await;
            if pending.len() >= crate::resource_limits::PENDING_REQUESTS
                || pending.contains_key(&id)
            {
                return Err(
                    "[lsp.request_conflict] Pending request limit reached or duplicate request ID"
                        .into(),
                );
            }
            pending.insert(id, sender);
        }
        let _pending = PendingGuard {
            id,
            pending: self.response_waiters.clone(),
        };
        if self
            .writer_tx
            .try_send(message.to_string().into_bytes())
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
        if method != "exit"
            && (!self.active.load(Ordering::Acquire)
                || self
                    .app_handle
                    .state::<crate::commands::fs::WorkspaceState>()
                    .generation()
                    != self.workspace_generation)
        {
            return Err(
                "[lsp.generation] Language server is no longer active in this workspace".into(),
            );
        }
        if method.len() > 128
            || serde_json::to_vec(&params)
                .map_err(|e| e.to_string())?
                .len()
                > crate::resource_limits::LSP_DOCUMENT_BYTES + 1024
        {
            return Err("[resource.limit] Language server notification is too large".into());
        }
        let message = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        self.writer_tx
            .try_send(message.to_string().into_bytes())
            .map_err(|_| "[lsp.backpressure] Language server writer is busy or closed".to_string())
    }

    pub async fn shutdown(&self) {
        self.active.store(false, Ordering::Release);
        self.set_status(LanguageServerStatus::Stopping, None).await;
        let _ = tokio::time::timeout(
            Duration::from_millis(500),
            self.call("shutdown", Value::Null),
        )
        .await;
        let _ = self.notify("exit", Value::Null).await;

        close_waiters(&self.response_waiters).await;

        let child = self.child.lock().ok().and_then(|mut child| child.take());
        if let Some(mut child) = child {
            child.wait_or_terminate(Duration::from_millis(500)).await;
        }
        if let Ok(mut tasks) = self.tasks.lock() {
            for task in tasks.drain(..) {
                task.abort();
            }
        }
        if let Ok(mut lease) = self.tool_use.lock() {
            lease.take();
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
    log_budget: &mut LogBudget,
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
                    if count > crate::resource_limits::PENDING_REQUESTS {
                        json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32602, "message": "Configuration item limit exceeded" } })
                    } else {
                        json!({ "jsonrpc": "2.0", "id": id, "result": vec![Value::Null; count] })
                    }
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
            if crate::commands::lsp_cmds::validate_protocol_paths(
                &app.state::<crate::commands::fs::WorkspaceState>(),
                &message,
                0,
            )
            .is_ok()
            {
                let _ = app.emit("lsp://diagnostics", &message);
            }
        }
        (None, Some("window/logMessage" | "window/showMessage")) => {
            let Some(throttled) = log_budget.admit(std::time::Instant::now()) else {
                return;
            };
            let text = if throttled {
                "Language server log rate limit reached; additional logs suppressed".into()
            } else {
                bounded_log_text(
                    message
                        .pointer("/params/message")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                )
            };
            let _ = app.emit(
                "lsp://log",
                json!({
                    "level": "info",
                    "source": "server",
                    "message": text
                }),
            );
        }
        _ => {
            if log_budget.admit(std::time::Instant::now()).is_some() {
                let _ = app.emit(
                    "lsp://log",
                    json!({"level": "debug", "source": "protocol",
                    "message": "Ignored undeclared language server message (bounded logging)"}),
                );
            }
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

struct LogBudget {
    started: std::time::Instant,
    emitted: usize,
}
impl Default for LogBudget {
    fn default() -> Self {
        Self {
            started: std::time::Instant::now(),
            emitted: 0,
        }
    }
}
impl LogBudget {
    fn admit(&mut self, now: std::time::Instant) -> Option<bool> {
        if now.duration_since(self.started) >= Duration::from_secs(1) {
            self.started = now;
            self.emitted = 0;
        }
        self.emitted = self.emitted.saturating_add(1);
        match self.emitted {
            1..=100 => Some(false),
            101 => Some(true),
            _ => None,
        }
    }
}

fn bounded_log_text(text: &str) -> String {
    let text = crate::redaction::redact(text);
    let mut end = text
        .len()
        .min(crate::resource_limits::PROCESS_LOG_LINE_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    if end == text.len() {
        text
    } else {
        format!("{} [log truncated]", &text[..end])
    }
}

// Keep a bounded prefix while draining the entire line, including unterminated logs.
async fn bounded_log_line(
    reader: &mut (impl tokio::io::AsyncBufRead + Unpin),
) -> std::io::Result<Option<String>> {
    let limit = crate::resource_limits::PROCESS_LOG_LINE_BYTES;
    let mut bytes = Vec::with_capacity(limit);
    let mut truncated = false;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            if bytes.is_empty() && !truncated {
                return Ok(None);
            }
            break;
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let content = newline.unwrap_or(available.len());
        let retained = content.min(limit - bytes.len());
        bytes.extend_from_slice(&available[..retained]);
        truncated |= content > retained;
        reader.consume(content + usize::from(newline.is_some()));
        if newline.is_some() {
            break;
        }
    }
    if !truncated && bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
    if truncated {
        // A prefix ending inside UTF-8 must not fabricate a replacement character.
        if let Err(error) = std::str::from_utf8(&bytes) {
            if error.error_len().is_none() {
                bytes.truncate(error.valid_up_to());
            }
        }
    }
    let mut line = String::from_utf8_lossy(&bytes).into_owned();
    if truncated {
        line.push_str(" [log truncated]");
    }
    Ok(Some(line))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_logs_are_bounded_redacted_and_rate_limited() {
        let mut budget = LogBudget::default();
        for _ in 0..100 {
            assert_eq!(budget.admit(budget.started), Some(false));
        }
        assert_eq!(budget.admit(budget.started), Some(true));
        for _ in 0..100_000 {
            assert_eq!(budget.admit(budget.started), None);
        }
        assert_eq!(
            budget.admit(budget.started + Duration::from_secs(1)),
            Some(false)
        );
        let text =
            bounded_log_text(&("Bearer secret-token ".to_owned() + &"\u{1f600}".repeat(100_000)));
        assert!(!text.contains("secret-token"));
        assert!(text.ends_with(" [log truncated]"));
        assert!(
            text.len() <= crate::resource_limits::PROCESS_LOG_LINE_BYTES + " [log truncated]".len()
        );
        assert!(!text.contains('\u{fffd}'));
    }

    #[tokio::test]
    async fn stderr_drains_oversized_lines_and_preserves_following_records() {
        let mut input = vec![b'x'; 4 * 1024 * 1024];
        input.extend_from_slice(b"\r\nnext\r\n\nlast");
        let mut reader = BufReader::with_capacity(7, input.as_slice());
        let first = bounded_log_line(&mut reader).await.unwrap().unwrap();
        assert_eq!(
            first.len(),
            crate::resource_limits::PROCESS_LOG_LINE_BYTES + " [log truncated]".len()
        );
        assert!(first.ends_with(" [log truncated]"));
        for expected in ["next", "", "last"] {
            assert_eq!(
                bounded_log_line(&mut reader).await.unwrap().as_deref(),
                Some(expected)
            );
        }
        assert!(bounded_log_line(&mut reader).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn stderr_preserves_unicode_across_chunks_and_truncated_prefixes() {
        let input = "a\u{4e2d}\u{1f600}z\n";
        for size in 1..=input.len() {
            let mut reader = BufReader::with_capacity(size, input.as_bytes());
            assert_eq!(
                bounded_log_line(&mut reader).await.unwrap().as_deref(),
                Some(input.trim_end())
            );
        }
        let input = "x".repeat(crate::resource_limits::PROCESS_LOG_LINE_BYTES - 1) + "\u{1f600}";
        let mut reader = BufReader::with_capacity(3, input.as_bytes());
        let line = bounded_log_line(&mut reader).await.unwrap().unwrap();
        assert!(!line.contains('\u{fffd}'));
        assert!(line.ends_with(" [log truncated]"));
    }
}
