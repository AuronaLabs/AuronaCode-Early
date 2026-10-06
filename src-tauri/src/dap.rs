use crate::content_length::{encode_message, ContentLengthDecoder};
use crate::process_service::ManagedChild;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::ChildStdin;
use tokio::sync::{mpsc, oneshot, watch, Mutex, OwnedSemaphorePermit, Semaphore};

type PendingResponse = oneshot::Sender<Result<Value, String>>;
type PendingRequests = Arc<Mutex<HashMap<u64, PendingResponse>>>;

#[derive(Default)]
struct Utf8Output(Vec<u8>);

impl Utf8Output {
    fn push(&mut self, bytes: &[u8], eof: bool) -> String {
        self.0.extend_from_slice(bytes);
        let mut output = String::new();
        loop {
            match std::str::from_utf8(&self.0) {
                Ok(text) => {
                    output.push_str(text);
                    self.0.clear();
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    output.push_str(std::str::from_utf8(&self.0[..valid]).unwrap_or_default());
                    self.0.drain(..valid);
                    if let Some(length) = error.error_len() {
                        output.push(char::REPLACEMENT_CHARACTER);
                        self.0.drain(..length);
                    } else {
                        if eof && !self.0.is_empty() {
                            output.push(char::REPLACEMENT_CHARACTER);
                            self.0.clear();
                        }
                        break;
                    }
                }
            }
        }
        output
    }
}

struct EventBudget {
    started: std::time::Instant,
    count: usize,
}
impl Default for EventBudget {
    fn default() -> Self {
        Self {
            started: std::time::Instant::now(),
            count: 0,
        }
    }
}
impl EventBudget {
    fn consume(&mut self, size: usize) -> Result<(), String> {
        if self.started.elapsed() >= Duration::from_secs(1) {
            self.started = std::time::Instant::now();
            self.count = 0;
        }
        if size > 1024 * 1024 || self.count >= 256 {
            return Err("[dap.event_limit] Debug event quota exceeded; session stopped".into());
        }
        self.count += 1;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapEvent {
    pub session_id: String,
    pub instance_id: String,
    pub event: String,
    pub body: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapOutput {
    pub category: String,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapOutputBatch {
    pub session_id: String,
    pub instance_id: String,
    pub seq: u64,
    pub entries: Vec<DapOutput>,
}

#[derive(Default)]
struct OutputWindow {
    pending: Mutex<HashMap<u64, OwnedSemaphorePermit>>,
    sequence: AtomicU64,
}

impl OutputWindow {
    async fn reserve(&self, permit: OwnedSemaphorePermit) -> u64 {
        let seq = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        self.pending.lock().await.insert(seq, permit);
        seq
    }

    async fn acknowledge(&self, seq: u64) {
        self.pending.lock().await.remove(&seq);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapSessionInfo {
    pub session_id: String,
    pub instance_id: String,
    pub state: String,
    pub command: String,
    pub pid: Option<u32>,
    pub last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapLaunch {
    pub session_id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub request_timeout_ms: Option<u64>,
}

pub struct DapSession {
    info: Mutex<DapSessionInfo>,
    stdin: Mutex<ChildStdin>,
    child: Mutex<Option<ManagedChild>>,
    pending: PendingRequests,
    next_seq: AtomicU64,
    request_timeout: Duration,
    output: mpsc::Sender<DapOutput>,
    output_window: OutputWindow,
    stopped: watch::Sender<bool>,
    generation: u64,
    events: Mutex<EventBudget>,
    tool_use: Mutex<Option<crate::toolchains::ToolUseLease>>,
}

impl DapSession {
    pub async fn start(
        app: AppHandle,
        launch: DapLaunch,
        tool_use: crate::toolchains::ToolUseLease,
        generation: u64,
    ) -> Result<Arc<Self>, String> {
        use tauri::Manager;
        if app
            .state::<crate::commands::fs::WorkspaceState>()
            .generation()
            != generation
        {
            return Err("[workspace.generation] Debugger authorization expired".into());
        }
        if launch.command.trim().is_empty() {
            return Err("Debug adapter command cannot be empty".into());
        }
        let mut command = tokio::process::Command::new(&launch.command);
        command
            .args(&launch.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = launch.cwd.as_deref() {
            command.current_dir(cwd);
        }
        command.envs(&launch.env);
        ManagedChild::configure(&mut command);

        let mut child = command.spawn().map_err(|error| {
            format!(
                "Unable to start debug adapter executable `{}`: {error}",
                launch.command
            )
        })?;
        let pid = child.id();
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Debug adapter stdin is unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Debug adapter stdout is unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Debug adapter stderr is unavailable".to_string())?;
        let managed = ManagedChild::attach(child)?;

        let (output, receiver) = mpsc::channel(64);
        let (stopped, _) = watch::channel(false);
        let session = Arc::new(Self {
            info: Mutex::new(DapSessionInfo {
                session_id: launch.session_id.clone(),
                instance_id: format!("dap-{:032x}", rand::random::<u128>()),
                state: "running".into(),
                command: launch.command,
                pid,
                last_error: None,
            }),
            stdin: Mutex::new(stdin),
            child: Mutex::new(Some(managed)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_seq: AtomicU64::new(1),
            request_timeout: Duration::from_millis(
                launch
                    .request_timeout_ms
                    .unwrap_or(10_000)
                    .clamp(500, 120_000),
            ),
            output,
            output_window: OutputWindow::default(),
            stopped,
            generation,
            events: Mutex::new(EventBudget::default()),
            tool_use: Mutex::new(Some(tool_use)),
        });
        Self::pump_output(session.clone(), app.clone(), receiver);
        Self::read_stdout(session.clone(), app.clone(), stdout);
        Self::read_stderr(session.clone(), app, stderr);
        Ok(session)
    }

    fn enqueue_output(&self, category: String, output: &str) -> Result<(), String> {
        if *self.stopped.borrow() {
            return Err("[dap.stopped] Debug session stopped".into());
        }
        let mut remaining = output;
        while !remaining.is_empty() {
            let mut end = remaining.len().min(32 * 1024);
            while !remaining.is_char_boundary(end) {
                end -= 1;
            }
            self.output
                .try_send(DapOutput {
                    category: category.clone(),
                    output: remaining[..end].to_string(),
                })
                .map_err(|_| {
                    "[dap.output_limit] Debug output exceeded its bounded queue; session stopped"
                })?;
            remaining = &remaining[end..];
        }
        Ok(())
    }

    fn pump_output(session: Arc<Self>, app: AppHandle, mut receiver: mpsc::Receiver<DapOutput>) {
        tokio::spawn(async move {
            let credits = Arc::new(Semaphore::new(4));
            let mut stopped = session.stopped.subscribe();
            loop {
                if *stopped.borrow() {
                    break;
                }
                let first = tokio::select! {
                    _ = stopped.changed() => break,
                    entry = receiver.recv() => match entry { Some(entry) => entry, None => break },
                };
                let permit = tokio::select! {
                    _ = stopped.changed() => break,
                    permit = credits.clone().acquire_owned() => match permit { Ok(permit) => permit, Err(_) => break },
                };
                let mut entries = vec![first];
                let mut bytes = entries[0].output.len();
                tokio::select! {
                    _ = stopped.changed() => break,
                    _ = tokio::time::sleep(Duration::from_millis(16)) => {},
                }
                while bytes < 64 * 1024 {
                    let Ok(entry) = receiver.try_recv() else {
                        break;
                    };
                    bytes += entry.output.len();
                    entries.push(entry);
                }
                let info = session.info().await;
                let seq = session.output_window.reserve(permit).await;
                if app
                    .emit(
                        "dap://output",
                        DapOutputBatch {
                            session_id: info.session_id,
                            instance_id: info.instance_id,
                            seq,
                            entries,
                        },
                    )
                    .is_err()
                {
                    session
                        .fail(
                            &app,
                            "[dap.output_delivery] Debug output delivery failed".into(),
                        )
                        .await;
                    break;
                }
            }
            session.output_window.pending.lock().await.clear();
        });
    }

    fn read_stdout(session: Arc<Self>, app: AppHandle, mut stdout: tokio::process::ChildStdout) {
        tokio::spawn(async move {
            let mut stopped = session.stopped.subscribe();
            let mut decoder = ContentLengthDecoder::default();
            let mut buffer = [0_u8; 8192];
            loop {
                if *stopped.borrow() {
                    return;
                }
                let read = tokio::select! {
                    _ = stopped.changed() => return,
                    read = stdout.read(&mut buffer) => read,
                };
                match read {
                    Ok(0) => break,
                    Ok(length) => {
                        decoder.push(&buffer[..length]);
                        loop {
                            match decoder.next_message() {
                                Ok(Some(body)) => {
                                    if let Err(error) =
                                        Self::route_message(&session, &app, &body).await
                                    {
                                        session.fail(&app, error).await;
                                        return;
                                    }
                                }
                                Ok(None) => break,
                                Err(error) => {
                                    session.fail(&app, error.to_string()).await;
                                    return;
                                }
                            }
                        }
                    }
                    Err(error) => {
                        session.fail(&app, error.to_string()).await;
                        return;
                    }
                }
            }
            let state = session.info.lock().await.state.clone();
            if state != "stopping" && state != "stopped" {
                session
                    .fail(&app, "Debug adapter exited unexpectedly".into())
                    .await;
            }
        });
    }

    fn read_stderr(session: Arc<Self>, app: AppHandle, mut stderr: tokio::process::ChildStderr) {
        tokio::spawn(async move {
            let mut stopped = session.stopped.subscribe();
            let mut buffer = [0_u8; 4096];
            let mut utf8 = Utf8Output::default();
            loop {
                if *stopped.borrow() {
                    return;
                }
                let read = tokio::select! {
                    _ = stopped.changed() => return,
                    read = stderr.read(&mut buffer) => read,
                };
                match read {
                    Ok(0) => {
                        if let Err(error) =
                            session.enqueue_output("stderr".into(), &utf8.push(&[], true))
                        {
                            session.fail(&app, error).await;
                        }
                        break;
                    }
                    Err(error) => {
                        session.fail(&app, format!("[dap.stderr] {error}")).await;
                        break;
                    }
                    Ok(length) => {
                        if let Err(error) = session
                            .enqueue_output("stderr".into(), &utf8.push(&buffer[..length], false))
                        {
                            session.fail(&app, error).await;
                            return;
                        }
                    }
                }
            }
        });
    }

    async fn route_message(
        session: &Arc<Self>,
        app: &AppHandle,
        body: &[u8],
    ) -> Result<(), String> {
        let message: Value =
            serde_json::from_slice(body).map_err(|error| format!("Invalid DAP JSON: {error}"))?;
        match message.get("type").and_then(Value::as_str) {
            Some("response") => {
                let request_seq = message
                    .get("request_seq")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| "DAP response has no request_seq".to_string())?;
                if let Some(sender) = session.pending.lock().await.remove(&request_seq) {
                    let success = message
                        .get("success")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let result = if success {
                        Ok(message.get("body").cloned().unwrap_or(Value::Null))
                    } else {
                        Err(message
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("Debug adapter request failed")
                            .to_string())
                    };
                    let _ = sender.send(result);
                }
            }
            Some("event") => {
                let event = message
                    .get("event")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                if event == "output" {
                    let body = message
                        .get("body")
                        .ok_or("[dap.schema] Missing output body")?;
                    session.enqueue_output(
                        body.get("category")
                            .and_then(Value::as_str)
                            .unwrap_or("console")
                            .to_string(),
                        body.get("output")
                            .and_then(Value::as_str)
                            .ok_or("[dap.schema] Missing output text")?,
                    )?;
                    return Ok(());
                }
                session.events.lock().await.consume(body.len())?;
                let info = session.info().await;
                app.emit(
                    "dap://event",
                    DapEvent {
                        session_id: info.session_id.clone(),
                        instance_id: info.instance_id,
                        event: event.clone(),
                        body: message.get("body").cloned().unwrap_or(Value::Null),
                    },
                )
                .map_err(|_| "[dap.event_delivery] Debug event delivery failed")?;
                if event == "terminated" || event == "exited" {
                    session.stop().await;
                }
            }
            Some("request") => {
                session.events.lock().await.consume(body.len())?;
                let request_seq = message.get("seq").and_then(Value::as_u64).unwrap_or(0);
                let command = message
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                session
                    .write(json!({
                        "seq": session.next_seq.fetch_add(1, Ordering::Relaxed),
                        "type": "response",
                        "request_seq": request_seq,
                        "success": false,
                        "command": command,
                        "message": "Adapter requests are not supported by this Aurona Code build"
                    }))
                    .await?;
            }
            _ => return Err("Unknown DAP message type".into()),
        }
        Ok(())
    }

    async fn write(&self, message: Value) -> Result<(), String> {
        if *self.stopped.borrow() {
            return Err("[dap.stopped] Debug session stopped".into());
        }
        let body = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
        let mut stopped = self.stopped.subscribe();
        tokio::select! {
        _ = stopped.changed() => Err("[dap.stopped] Debug session stopped".into()),
        result = tokio::time::timeout(self.request_timeout, async { self.stdin
            .lock()
            .await
            .write_all(&encode_message(&body))
            .await
            .map_err(|error| error.to_string()) }) => result.map_err(|_| "[dap.write_timeout] Debug adapter input blocked".to_string())?,
        }
    }

    pub async fn request(&self, command: String, arguments: Value) -> Result<Value, String> {
        if *self.stopped.borrow() {
            return Err("[dap.stopped] Debug session stopped".into());
        }
        if command.is_empty()
            || command.len() > 128
            || serde_json::to_vec(&arguments)
                .map_err(|e| e.to_string())?
                .len()
                > crate::resource_limits::LSP_CHANGE_BYTES
        {
            return Err("[resource.limit] Debug adapter request exceeds its budget".into());
        }
        let command_name = command.clone();
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            if pending.len() >= crate::resource_limits::PENDING_REQUESTS {
                return Err("[resource.limit] Debug adapter pending limit reached".into());
            }
            pending.insert(seq, sender);
        }
        if let Err(error) = self
            .write(json!({
                "seq": seq,
                "type": "request",
                "command": command,
                "arguments": arguments
            }))
            .await
        {
            self.pending.lock().await.remove(&seq);
            return Err(error);
        }
        match tokio::time::timeout(self.request_timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(format!(
                "Debug adapter request `{command_name}` was cancelled"
            )),
            Err(_) => {
                self.pending.lock().await.remove(&seq);
                Err(format!(
                    "Debug adapter request `{command_name}` timed out after {} ms",
                    self.request_timeout.as_millis()
                ))
            }
        }
    }

    pub async fn info(&self) -> DapSessionInfo {
        self.info.lock().await.clone()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub async fn acknowledge_output(&self, instance_id: &str, seq: u64) {
        if self.info.lock().await.instance_id == instance_id {
            self.output_window.acknowledge(seq).await;
        }
    }

    pub async fn wait_stopped(&self) {
        let mut stopped = self.stopped.subscribe();
        while !*stopped.borrow() {
            if stopped.changed().await.is_err() {
                break;
            }
        }
    }

    pub async fn stop(&self) {
        self.stopped.send_replace(true);
        self.output_window.pending.lock().await.clear();
        self.info.lock().await.state = "stopping".into();
        for (_, sender) in self.pending.lock().await.drain() {
            let _ = sender.send(Err("Debug session stopped".into()));
        }
        if let Some(mut child) = self.child.lock().await.take() {
            child.wait_or_terminate(Duration::from_secs(1)).await;
        }
        self.tool_use.lock().await.take();
        self.info.lock().await.state = "stopped".into();
    }

    async fn fail(&self, app: &AppHandle, error: String) {
        let mut info = self.info.lock().await;
        if info.state == "failed" || info.state == "stopping" || info.state == "stopped" {
            return;
        }
        info.state = "failed".into();
        info.last_error = Some(error.clone());
        let snapshot = info.clone();
        drop(info);
        self.stopped.send_replace(true);
        self.output_window.pending.lock().await.clear();
        for (_, sender) in self.pending.lock().await.drain() {
            let _ = sender.send(Err("Debug adapter exited".into()));
        }
        if let Some(mut child) = self.child.lock().await.take() {
            child.terminate_now();
            child.wait_or_terminate(Duration::from_millis(500)).await;
        }
        self.tool_use.lock().await.take();
        let _ = app.emit(
            "dap://event",
            DapEvent {
                session_id: snapshot.session_id,
                instance_id: snapshot.instance_id,
                event: "auronaFailed".into(),
                body: json!({ "message": crate::redaction::redact(&error) }),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn output_window_ignores_forged_duplicate_acknowledgements() {
        let window = OutputWindow::default();
        let permits = Arc::new(Semaphore::new(4));
        for _ in 0..4 {
            window
                .reserve(permits.clone().acquire_owned().await.unwrap())
                .await;
        }
        assert!(permits.try_acquire().is_err());
        window.acknowledge(999).await;
        assert!(permits.try_acquire().is_err());
        window.acknowledge(2).await;
        window.acknowledge(2).await;
        assert_eq!(permits.available_permits(), 1);
        window.pending.lock().await.clear();
        assert_eq!(permits.available_permits(), 4);
    }

    #[test]
    fn stderr_preserves_unicode_at_every_chunk_boundary() {
        let text = "a\u{4e2d}\u{1f600}z";
        for split in 0..=text.len() {
            let mut decoder = Utf8Output::default();
            let output = decoder.push(&text.as_bytes()[..split], false)
                + &decoder.push(&text.as_bytes()[split..], true);
            assert_eq!(output, text);
            assert!(decoder.0.is_empty());
        }
    }

    #[test]
    fn non_output_events_have_a_separate_bounded_budget() {
        let mut budget = EventBudget::default();
        for _ in 0..256 {
            budget.consume(100).unwrap();
        }
        assert!(budget.consume(100).is_err());
        assert!(EventBudget::default().consume(1024 * 1024 + 1).is_err());
    }
}
