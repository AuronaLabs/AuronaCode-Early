//! 0.4.6 批次 5：AI 助手流式代理（OpenAI 兼容 /chat/completions SSE）。
//!
//! 前端通过 `ai_chat_send` 发起流式对话，Rust 侧逐块解析 SSE 并以
//! `ai://chat-start` / `ai://chat-delta` / `ai://chat-done` / `ai://chat-error`
//! 事件推回。所有请求走 `network::configure_client` 全局代理客户端
//! （0.4.3 承诺：代理设置覆盖一切 Rust 侧网络）。
//! 隐私优先：对话内容仅经用户配置的服务商转发，无任何遥测。

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

/// 单次请求超时（含整个流式响应读取）
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// OpenAI 兼容聊天消息（字段名对齐 wire format，无需 camelCase）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessagePayload {
    pub role: String,
    pub content: String,
}

/// 会话中止标记集合（sessionId → 是否请求中止）
#[derive(Default)]
pub struct AiChatState {
    aborts: Mutex<HashSet<String>>,
}

impl AiChatState {
    fn has_abort(&self, session_id: &str) -> bool {
        self.aborts
            .lock()
            .map(|set| set.contains(session_id))
            .unwrap_or(false)
    }

    fn clear_abort(&self, session_id: &str) {
        if let Ok(mut set) = self.aborts.lock() {
            set.remove(session_id);
        }
    }

    fn insert_abort(&self, session_id: &str) {
        if let Ok(mut set) = self.aborts.lock() {
            set.insert(session_id.to_string());
        }
    }
}

/// 解析单行 SSE 数据，提取 choices[0].delta.content 增量文本。
/// 非 `data:` 行 / [DONE] / 无法解析 / 无增量内容时返回 None。
pub fn parse_sse_delta(line: &str) -> Option<String> {
    let data = line.trim_start().strip_prefix("data:")?;
    let data = data.trim_start();
    if data == "[DONE]" {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    let text = value
        .get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()?;
    Some(text.to_string())
}

/// 解析单行 SSE 数据中的 choices[0].finish_reason（末尾分片携带）
pub fn parse_sse_finish_reason(line: &str) -> Option<String> {
    let data = line.trim_start().strip_prefix("data:")?;
    let data = data.trim_start();
    if data == "[DONE]" {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    let reason = value
        .get("choices")?
        .get(0)?
        .get("finish_reason")?
        .as_str()?;
    Some(reason.to_string())
}

/// 将 reqwest 请求错误映射为结构化 code：connect / timeout / generic
fn classify_request_error(error: &reqwest::Error) -> (&'static str, String) {
    if error.is_timeout() {
        ("timeout", "请求超时（120 秒）".to_string())
    } else if error.is_connect() {
        ("connect", format!("连接失败: {error}"))
    } else {
        ("generic", format!("{error}"))
    }
}

/// 发起流式对话。命令本身不返回错误——请求失败通过 `ai://chat-error` 事件
/// 携带结构化 code（connect/auth/rate_limit/timeout/generic）推回前端。
#[tauri::command]
pub async fn ai_chat_send(
    app: AppHandle,
    state: State<'_, AiChatState>,
    session_id: String,
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessagePayload>,
) -> Result<(), String> {
    // 发送前检查 abort 标记
    if state.has_abort(&session_id) {
        state.clear_abort(&session_id);
        let _ = app.emit(
            "ai://chat-done",
            json!({ "sessionId": session_id, "aborted": true, "finishReason": "aborted" }),
        );
        return Ok(());
    }

    let url = format!("{}/chat/completions", base_url.trim().trim_end_matches('/'));
    let body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });

    // 必须走全局代理客户端：代理设置覆盖一切 Rust 侧网络
    let client =
        match crate::network::configure_client(reqwest::Client::builder().timeout(REQUEST_TIMEOUT))
        {
            Ok(client) => client,
            Err(message) => {
                let _ = app.emit(
                    "ai://chat-error",
                    json!({ "sessionId": session_id, "code": "generic", "message": message }),
                );
                return Ok(());
            }
        };

    let response = match client
        .post(&url)
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            let (code, message) = classify_request_error(&error);
            let _ = app.emit(
                "ai://chat-error",
                json!({ "sessionId": session_id, "code": code, "message": message }),
            );
            return Ok(());
        }
    };

    let status = response.status();
    if !status.is_success() {
        let code = match status.as_u16() {
            401 | 403 => "auth",
            429 => "rate_limit",
            _ => "generic",
        };
        // 附带服务端返回的错误摘要（截断，避免超长）
        let detail = response.text().await.unwrap_or_default();
        let detail = detail.chars().take(300).collect::<String>();
        let message = format!("HTTP {}: {detail}", status.as_u16());
        let _ = app.emit(
            "ai://chat-error",
            json!({ "sessionId": session_id, "code": code, "message": message }),
        );
        return Ok(());
    }

    let _ = app.emit("ai://chat-start", json!({ "sessionId": session_id }));

    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut finish_reason: Option<String> = None;

    loop {
        // 每块接收前检查 abort 标记：标记存在则停止并移除
        if state.has_abort(&session_id) {
            state.clear_abort(&session_id);
            let _ = app.emit(
                "ai://chat-done",
                json!({ "sessionId": session_id, "aborted": true, "finishReason": "aborted" }),
            );
            return Ok(());
        }

        match stream.next().await {
            Some(Ok(chunk)) => {
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                // 逐行解析；最后一段可能不完整，保留在 buffer
                while let Some(position) = buffer.find('\n') {
                    let line: String = buffer.drain(..position + 1).collect();
                    let line = line.trim_end();
                    if let Some(reason) = parse_sse_finish_reason(line) {
                        finish_reason = Some(reason);
                    }
                    if let Some(delta) = parse_sse_delta(line) {
                        if !delta.is_empty() {
                            let _ = app.emit(
                                "ai://chat-delta",
                                json!({ "sessionId": session_id, "delta": delta }),
                            );
                        }
                    }
                }
            }
            Some(Err(error)) => {
                let (code, message) = classify_request_error(&error);
                let _ = app.emit(
                    "ai://chat-error",
                    json!({ "sessionId": session_id, "code": code, "message": message }),
                );
                return Ok(());
            }
            None => break,
        }
    }

    let _ = app.emit(
        "ai://chat-done",
        json!({
            "sessionId": session_id,
            "aborted": false,
            "finishReason": finish_reason.unwrap_or_else(|| "stop".to_string()),
        }),
    );
    Ok(())
}

/// 请求中止当前会话的流式输出
#[tauri::command]
pub fn ai_chat_abort(state: State<'_, AiChatState>, session_id: String) -> Result<(), String> {
    state.insert_abort(&session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sse_delta_extracts_content() {
        let line = r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#;
        assert_eq!(parse_sse_delta(line), Some("你好".to_string()));
    }

    #[test]
    fn parse_sse_delta_without_space_after_prefix() {
        let line = r#"data:{"choices":[{"delta":{"content":"A"}}]}"#;
        assert_eq!(parse_sse_delta(line), Some("A".to_string()));
    }

    #[test]
    fn parse_sse_delta_done_returns_none() {
        assert_eq!(parse_sse_delta("data: [DONE]"), None);
        assert_eq!(parse_sse_delta("data:[DONE]"), None);
    }

    #[test]
    fn parse_sse_delta_ignores_non_data_lines() {
        assert_eq!(parse_sse_delta(": keep-alive"), None);
        assert_eq!(parse_sse_delta("event: message"), None);
        assert_eq!(parse_sse_delta(""), None);
    }

    #[test]
    fn parse_sse_delta_rejects_bad_json() {
        assert_eq!(parse_sse_delta("data: {not json"), None);
        // 合法 JSON 但无增量内容字段
        assert_eq!(parse_sse_delta(r#"data: {"choices":[]}"#), None);
        // finish 分片的 delta 通常没有 content
        assert_eq!(
            parse_sse_delta(r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#),
            None
        );
    }

    #[test]
    fn parse_sse_finish_reason_extracts_reason() {
        let line = r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#;
        assert_eq!(parse_sse_finish_reason(line), Some("stop".to_string()));
        assert_eq!(parse_sse_finish_reason("data: [DONE]"), None);
    }
}
