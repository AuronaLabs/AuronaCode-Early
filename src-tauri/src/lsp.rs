use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};
use tauri::Emitter;

pub struct LspClient {
    id_counter: AtomicU64,
    writer_tx: mpsc::Sender<String>,
    response_waiters: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    // 任务 E：存储子进程句柄，Drop 时自动 kill
    child: Option<tokio::process::Child>,
}

// 任务 E：实现 Drop，进程退出时自动清理
impl Drop for LspClient {
    fn drop(&mut self) {
        self.child.take().map(|mut c| {
            let _ = c.start_kill();
        });
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

        let mut stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();

        let (writer_tx, mut writer_rx) = mpsc::channel::<String>(32);
        let response_waiters: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let waiters_clone = Arc::clone(&response_waiters);

        // 写入任务
        tokio::spawn(async move {
            while let Some(msg) = writer_rx.recv().await {
                let formatted = format!("Content-Length: {}\r\n\r\n{}", msg.len(), msg);
                if stdin.write_all(formatted.as_bytes()).await.is_err() {
                    break;
                }
                let _ = stdin.flush().await;
            }
        });

        // 读取任务
        tokio::spawn(async move {
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

                    let line = String::from_utf8_lossy(&line_buf);
                    if line == "\r\n" {
                        break; // 请求头结束
                    }

                    if line.to_lowercase().starts_with("content-length:") {
                        let parts: Vec<&str> = line.split(':').collect();
                        if parts.len() == 2 {
                            if let Ok(len) = parts[1].trim().parse::<usize>() {
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

                if let Ok(body_str) = String::from_utf8(body_buf) {
                    if let Ok(json) = serde_json::from_str::<Value>(&body_str) {
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
            }
        });

        // 任务 E：将 child 移入结构体
        Ok(Self {
            id_counter: AtomicU64::new(1),
            writer_tx,
            response_waiters,
            child: Some(child),
        })
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.id_counter.fetch_add(1, Ordering::SeqCst);
        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let (tx, rx) = oneshot::channel();
        self.response_waiters.lock().await.insert(id, tx);

        self.writer_tx
            .send(msg.to_string())
            .await
            .map_err(|_| "Writer channel closed")?;

        // 任务 F：对 rx.await 施加 30 秒超时，防止永久等待
        tokio::time::timeout(Duration::from_secs(30), rx)
            .await
            .map_err(|_| "LSP call timed out after 30 seconds".to_string())?
            .map_err(|_| "Response channel closed".to_string())
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
}
