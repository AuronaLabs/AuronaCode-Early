use crate::content_length::{encode_message, ContentLengthDecoder};
use crate::process_tree::ManagedChild;
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
use tokio::sync::{oneshot, Mutex};

type PendingResponse = oneshot::Sender<Result<Value, String>>;
type PendingRequests = Arc<Mutex<HashMap<u64, PendingResponse>>>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapEvent {
    pub session_id: String,
    pub event: String,
    pub body: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapOutput {
    pub session_id: String,
    pub category: String,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapSessionInfo {
    pub session_id: String,
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
}

impl DapSession {
    pub async fn start(app: AppHandle, launch: DapLaunch) -> Result<Arc<Self>, String> {
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

        let session = Arc::new(Self {
            info: Mutex::new(DapSessionInfo {
                session_id: launch.session_id.clone(),
                state: "starting".into(),
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
        });
        Self::read_stdout(session.clone(), app.clone(), stdout);
        Self::read_stderr(session.clone(), app, stderr);
        session.info.lock().await.state = "running".into();
        Ok(session)
    }

    fn read_stdout(session: Arc<Self>, app: AppHandle, mut stdout: tokio::process::ChildStdout) {
        tokio::spawn(async move {
            let mut decoder = ContentLengthDecoder::default();
            let mut buffer = [0_u8; 8192];
            loop {
                match stdout.read(&mut buffer).await {
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
            let mut buffer = [0_u8; 4096];
            loop {
                match stderr.read(&mut buffer).await {
                    Ok(0) | Err(_) => break,
                    Ok(length) => {
                        let info = session.info.lock().await;
                        let _ = app.emit(
                            "dap://output",
                            DapOutput {
                                session_id: info.session_id.clone(),
                                category: "stderr".into(),
                                output: String::from_utf8_lossy(&buffer[..length]).into_owned(),
                            },
                        );
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
                let mut info = session.info.lock().await;
                if event == "terminated" || event == "exited" {
                    info.state = "stopping".into();
                }
                let _ = app.emit(
                    "dap://event",
                    DapEvent {
                        session_id: info.session_id.clone(),
                        event,
                        body: message.get("body").cloned().unwrap_or(Value::Null),
                    },
                );
            }
            Some("request") => {
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
        let body = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
        self.stdin
            .lock()
            .await
            .write_all(&encode_message(&body))
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn request(&self, command: String, arguments: Value) -> Result<Value, String> {
        let command_name = command.clone();
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(seq, sender);
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

    pub async fn stop(&self) {
        self.info.lock().await.state = "stopping".into();
        for (_, sender) in self.pending.lock().await.drain() {
            let _ = sender.send(Err("Debug session stopped".into()));
        }
        if let Some(mut child) = self.child.lock().await.take() {
            child.wait_or_terminate(Duration::from_secs(1)).await;
        }
        self.info.lock().await.state = "stopped".into();
    }

    async fn fail(&self, app: &AppHandle, error: String) {
        let mut info = self.info.lock().await;
        if info.state == "failed" || info.state == "stopping" || info.state == "stopped" {
            return;
        }
        info.state = "failed".into();
        info.last_error = Some(error.clone());
        let _ = app.emit(
            "dap://output",
            DapOutput {
                session_id: info.session_id.clone(),
                category: "error".into(),
                output: error,
            },
        );
        for (_, sender) in self.pending.lock().await.drain() {
            let _ = sender.send(Err("Debug adapter exited".into()));
        }
    }
}
