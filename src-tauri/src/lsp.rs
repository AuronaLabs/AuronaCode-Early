use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::process_tree::ManagedChild;

pub struct LspClient {
    id_counter: AtomicU64,
    writer_tx: mpsc::Sender<String>,
    response_waiters: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    child: std::sync::Mutex<Option<ManagedChild>>,
    tasks: std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>>,
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
    pub async fn start(
        command: &str,
        args: &[&str],
        app_handle: tauri::AppHandle,
    ) -> Result<Self, String> {
        let mut cmd = Command::new(command);
        cmd.args(args);

        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = cmd
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn LSP: {}", e))?;

        let mut stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let managed_child = ManagedChild::attach(child)?;

        let (writer_tx, mut writer_rx) = mpsc::channel::<String>(32);
        let response_waiters: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let waiters_clone = Arc::clone(&response_waiters);

        // 写入任务
        let writer_task = tokio::spawn(async move {
            while let Some(msg) = writer_rx.recv().await {
                let header = format!("Content-Length: {}\r\n\r\n", msg.len());
                if stdin.write_all(header.as_bytes()).await.is_err() {
                    break;
                }
                if stdin.write_all(msg.as_bytes()).await.is_err() {
                    break;
                }
                let _ = stdin.flush().await;
            }
        });

        // 读取任务
        let reader_task = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);

            loop {
                let mut content_length = 0;

                // 读取请求头
                loop {
                    let mut line_buf = vec![];
                    loop {
                        let mut byte = [0u8; 1];
                        if reader.read_exact(&mut byte).await.is_err() {
                            return; // 进程已退出
                        }
                        line_buf.push(byte[0]);
                        if line_buf.ends_with(b"\r\n") {
                            break;
                        }
                    }

                    if line_buf == b"\r\n" || line_buf == b"\n" {
                        break; // 请求头结束
                    }

                    if line_buf.len() > 15
                        && line_buf[..15].eq_ignore_ascii_case(b"content-length:")
                    {
                        let line = String::from_utf8_lossy(&line_buf);
                        if let Some(val) = line.split_once(':') {
                            if let Ok(len) = val.1.trim().parse::<usize>() {
                                content_length = len;
                            }
                        }
                    }
                }

                // 任务 G：content_length 为 0 时 break 而非 continue，避免死循环
                if content_length == 0 {
                    break;
                }

                // 读取消息体
                let mut body_buf = vec![0u8; content_length];
                if reader.read_exact(&mut body_buf).await.is_err() {
                    return;
                }

                if let Ok(json) = serde_json::from_slice::<Value>(&body_buf) {
                    if let Some(id) = json.get("id").and_then(|id| id.as_u64()) {
                        // 响应消息
                        let mut waiters = waiters_clone.lock().await;
                        if let Some(sender) = waiters.remove(&id) {
                            let _ = sender.send(json);
                        }
                    } else if let Some(method) = json.get("method").and_then(|m| m.as_str()) {
                        // 服务端推送通知
                        if method == "textDocument/publishDiagnostics" {
                            let _ = app_handle.emit("lsp://diagnostics", &json);
                        }
                    }
                }
            }
        });

        Ok(Self {
            id_counter: AtomicU64::new(1),
            writer_tx,
            response_waiters,
            child: std::sync::Mutex::new(Some(managed_child)),
            tasks: std::sync::Mutex::new(vec![writer_task, reader_task]),
        })
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
        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let (tx, rx) = oneshot::channel();
        self.response_waiters.lock().await.insert(id, tx);

        if self.writer_tx.send(msg.to_string()).await.is_err() {
            self.response_waiters.lock().await.remove(&id);
            return Err("Writer channel closed".to_string());
        }

        // A timed-out or cancelled frontend request must not retain its oneshot
        // sender forever; diagnostics and completion requests can be frequent.
        match tokio::time::timeout(Duration::from_secs(30), rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => {
                self.response_waiters.lock().await.remove(&id);
                Err("Response channel closed".to_string())
            }
            Err(_) => {
                self.response_waiters.lock().await.remove(&id);
                Err("LSP call timed out after 30 seconds".to_string())
            }
        }
    }

    pub async fn cancel(&self, id: u64) -> Result<(), String> {
        let msg = json!({
            "jsonrpc": "2.0",
            "method": "$/cancelRequest",
            "params": {
                "id": id
            }
        });

        self.writer_tx
            .send(msg.to_string())
            .await
            .map_err(|_| "Writer channel closed")?;

        Ok(())
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let msg = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });

        self.writer_tx
            .send(msg.to_string())
            .await
            .map_err(|_| "Writer channel closed".to_string())
    }

    pub async fn shutdown(&self) {
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            self.call("shutdown", serde_json::Value::Null),
        )
        .await;
        let _ = self.notify("exit", serde_json::Value::Null).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        if let Ok(mut tasks) = self.tasks.lock() {
            for task in tasks.drain(..) {
                task.abort();
            }
        }
        self.response_waiters.lock().await.clear();

        let child = self.child.lock().ok().and_then(|mut child| child.take());
        if let Some(mut child) = child {
            child.wait_or_terminate(Duration::from_secs(1)).await;
        }
    }
}
