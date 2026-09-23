//! 0.4.6 批次 5：AI 助手流式代理（OpenAI 兼容 /chat/completions SSE）。
//! 0.4.7 稳定性重做：超时分级（连接 / 首 token / chunk 间隔 / 总时长硬顶）、
//! SSE 单次解析（content / finish_reason / tool_calls / usage 一次取全）、
//! tool_calls 协议预留（解析与透传，执行端后续版本落地）。
//!
//! 前端通过 `ai_chat_send` 发起流式对话，Rust 侧逐块解析 SSE 并以
//! `ai://chat-start` / `ai://chat-delta` / `ai://chat-done` / `ai://chat-error`
//! 事件推回。所有请求走 `network::configure_client` 全局代理客户端
//! （0.4.3 承诺：代理设置覆盖一切 Rust 侧网络）。
//! 隐私优先：对话内容仅经用户配置的服务商转发，无任何遥测。

use std::collections::HashSet;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::time::{timeout, Duration, Instant};

/// 连接超时（TCP/TLS 建链）
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// 首 token 超时：请求发出到首个 SSE 数据行（推理模型首 token 慢，取宽）
const FIRST_TOKEN_TIMEOUT: Duration = Duration::from_secs(60);
/// chunk 间隔超时：流式过程中相邻数据块的最大静默间隔
const CHUNK_IDLE_TIMEOUT: Duration = Duration::from_secs(90);
/// 单次会话总时长硬顶（防止异常服务端无限流式）
const OVERALL_TIMEOUT: Duration = Duration::from_secs(600);

/// OpenAI 兼容 tool_calls 字段（上行回传，arguments 为完整字符串）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolFunctionPayload {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolCallPayload {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: ChatToolFunctionPayload,
}

/// OpenAI 兼容聊天消息（字段名对齐 wire format；camelCase 由 serde 转换）。
/// content 可空：assistant 纯工具调用消息与 tool 结果消息按协议可缺省。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessagePayload {
    pub role: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ChatToolCallPayload>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
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

/// token 用量统计（服务端在末尾分片携带时透传）
#[derive(Debug, Default, PartialEq, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SseUsage {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

/// 单条 tool_calls 增量（前端按 index 聚合，arguments 为增量片段）
#[derive(Debug, Default, PartialEq, Serialize, Clone)]
pub struct SseToolCallDelta {
    pub index: u64,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments_delta: Option<String>,
}

/// 单行 SSE 解析结果（单次 JSON parse 取全四类字段）
#[derive(Debug, Default, PartialEq)]
pub struct SseLine {
    pub content: Option<String>,
    pub finish_reason: Option<String>,
    pub tool_calls: Vec<SseToolCallDelta>,
    pub usage: Option<SseUsage>,
}

impl SseLine {
    fn is_empty(&self) -> bool {
        self.content.is_none()
            && self.finish_reason.is_none()
            && self.tool_calls.is_empty()
            && self.usage.is_none()
    }
}

/// 解析单行 SSE 数据。非 `data:` 行 / [DONE] / 无法解析时返回 None；
/// 合法分片返回 SseLine（各字段可为空，usage-only 的收尾分片 choices 可能为空数组）。
pub fn parse_sse_line(line: &str) -> Option<SseLine> {
    let data = line.trim_start().strip_prefix("data:")?;
    let data = data.trim_start();
    if data == "[DONE]" {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;

    let first = value.get("choices").and_then(|choices| choices.get(0));
    let delta = first.and_then(|choice| choice.get("delta"));
    let content = delta
        .and_then(|d| d.get("content"))
        .and_then(|c| c.as_str())
        .map(str::to_string);
    let finish_reason = first
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(|r| r.as_str())
        .map(str::to_string);

    let mut tool_calls = Vec::new();
    if let Some(list) = delta
        .and_then(|d| d.get("tool_calls"))
        .and_then(|t| t.as_array())
    {
        for call in list {
            let function = call.get("function");
            tool_calls.push(SseToolCallDelta {
                index: call.get("index").and_then(|i| i.as_u64()).unwrap_or(0),
                id: call.get("id").and_then(|v| v.as_str()).map(str::to_string),
                name: function
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                arguments_delta: function
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            });
        }
    }

    let usage = value
        .get("usage")
        .and_then(|u| u.as_object())
        .map(|u| SseUsage {
            prompt_tokens: u.get("prompt_tokens").and_then(|v| v.as_u64()),
            completion_tokens: u.get("completion_tokens").and_then(|v| v.as_u64()),
            total_tokens: u.get("total_tokens").and_then(|v| v.as_u64()),
        });

    let parsed = SseLine {
        content,
        finish_reason,
        tool_calls,
        usage,
    };
    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

/// 将 reqwest 请求错误映射为结构化 code：connect / timeout / generic。
/// connect 判断必须先于 timeout——connect_timeout 触发时两者皆为真。
fn classify_request_error(error: &reqwest::Error) -> (&'static str, String) {
    if error.is_connect() {
        ("connect", format!("连接失败: {error}"))
    } else if error.is_timeout() {
        ("timeout", format!("请求超时: {error}"))
    } else {
        ("generic", format!("{error}"))
    }
}

/// 发起流式对话。命令本身不返回错误——请求失败通过 `ai://chat-error` 事件
/// 携带结构化 code（connect/auth/rate_limit/timeout/first_token_timeout/
/// idle_timeout/generic）推回前端。
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

    // 必须走全局代理客户端：代理设置覆盖一切 Rust 侧网络。
    // 不设整体 timeout（会掐断长流式），分级超时在下方逐一施加。
    let client = match crate::network::configure_client(
        reqwest::Client::builder().connect_timeout(CONNECT_TIMEOUT),
    ) {
        Ok(client) => client,
        Err(message) => {
            let _ = app.emit(
                "ai://chat-error",
                json!({ "sessionId": session_id, "code": "generic", "message": message }),
            );
            return Ok(());
        }
    };

    let first_token_deadline = Instant::now() + FIRST_TOKEN_TIMEOUT;
    let overall_deadline = Instant::now() + OVERALL_TIMEOUT;

    // 等待响应头计入首 token 预算
    let request = client.post(&url).bearer_auth(&api_key).json(&body);
    let response = match timeout(
        first_token_deadline.saturating_duration_since(Instant::now()),
        request.send(),
    )
    .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => {
            let (code, message) = classify_request_error(&error);
            let _ = app.emit(
                "ai://chat-error",
                json!({ "sessionId": session_id, "code": code, "message": message }),
            );
            return Ok(());
        }
        Err(_) => {
            let _ = app.emit(
                "ai://chat-error",
                json!({
                    "sessionId": session_id,
                    "code": "first_token_timeout",
                    "message": format!("首 token 超时（{} 秒）", FIRST_TOKEN_TIMEOUT.as_secs())
                }),
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
    let mut usage: Option<SseUsage> = None;
    let mut received_first_data = false;

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

        // 总时长硬顶
        if Instant::now() >= overall_deadline {
            let _ = app.emit(
                "ai://chat-error",
                json!({
                    "sessionId": session_id,
                    "code": "timeout",
                    "message": format!("会话总时长超限（{} 秒）", OVERALL_TIMEOUT.as_secs())
                }),
            );
            return Ok(());
        }

        // 首 token 预算未用完前按剩余预算等待，之后按 chunk 间隔超时
        let wait = if received_first_data {
            CHUNK_IDLE_TIMEOUT
        } else {
            let remaining = first_token_deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                let _ = app.emit(
                    "ai://chat-error",
                    json!({
                        "sessionId": session_id,
                        "code": "first_token_timeout",
                        "message": format!("首 token 超时（{} 秒）", FIRST_TOKEN_TIMEOUT.as_secs())
                    }),
                );
                return Ok(());
            }
            remaining
        };

        match timeout(wait, stream.next()).await {
            Ok(Some(Ok(chunk))) => {
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                // 逐行解析；最后一段可能不完整，保留在 buffer
                while let Some(position) = buffer.find('\n') {
                    let line: String = buffer.drain(..position + 1).collect();
                    let line = line.trim_end();
                    let Some(sse) = parse_sse_line(line) else {
                        continue;
                    };
                    received_first_data = true;
                    if let Some(reason) = sse.finish_reason {
                        finish_reason = Some(reason);
                    }
                    if let Some(u) = sse.usage {
                        usage = Some(u);
                    }
                    let has_content = sse.content.as_deref().is_some_and(|c| !c.is_empty());
                    if has_content || !sse.tool_calls.is_empty() {
                        let mut payload = json!({
                            "sessionId": session_id,
                            "delta": sse.content.unwrap_or_default(),
                        });
                        if !sse.tool_calls.is_empty() {
                            payload["toolCalls"] = json!(sse
                                .tool_calls
                                .iter()
                                .map(|call| {
                                    let mut item = json!({ "index": call.index });
                                    if let Some(id) = &call.id {
                                        item["id"] = json!(id);
                                    }
                                    if let Some(name) = &call.name {
                                        item["name"] = json!(name);
                                    }
                                    if let Some(args) = &call.arguments_delta {
                                        item["argumentsDelta"] = json!(args);
                                    }
                                    item
                                })
                                .collect::<Vec<_>>());
                        }
                        let _ = app.emit("ai://chat-delta", payload);
                    }
                }
            }
            Ok(Some(Err(error))) => {
                let (code, message) = classify_request_error(&error);
                let _ = app.emit(
                    "ai://chat-error",
                    json!({ "sessionId": session_id, "code": code, "message": message }),
                );
                return Ok(());
            }
            Ok(None) => break,
            Err(_) => {
                let code = if received_first_data {
                    "idle_timeout"
                } else {
                    "first_token_timeout"
                };
                let limit = if received_first_data {
                    CHUNK_IDLE_TIMEOUT.as_secs()
                } else {
                    FIRST_TOKEN_TIMEOUT.as_secs()
                };
                let _ = app.emit(
                    "ai://chat-error",
                    json!({
                        "sessionId": session_id,
                        "code": code,
                        "message": format!("响应静默超时（{limit} 秒）")
                    }),
                );
                return Ok(());
            }
        }
    }

    let mut done = json!({
        "sessionId": session_id,
        "aborted": false,
        "finishReason": finish_reason.unwrap_or_else(|| "stop".to_string()),
    });
    if let Some(u) = usage {
        if let Ok(value) = serde_json::to_value(u) {
            done["usage"] = value;
        }
    }
    let _ = app.emit("ai://chat-done", done);
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
    fn parse_sse_line_extracts_content() {
        let line = r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#;
        let parsed = parse_sse_line(line).expect("应解析出内容");
        assert_eq!(parsed.content, Some("你好".to_string()));
        assert!(parsed.tool_calls.is_empty());
        assert_eq!(parsed.finish_reason, None);
        assert_eq!(parsed.usage, None);
    }

    #[test]
    fn parse_sse_line_without_space_after_prefix() {
        let line = r#"data:{"choices":[{"delta":{"content":"A"}}]}"#;
        let parsed = parse_sse_line(line).expect("应解析出内容");
        assert_eq!(parsed.content, Some("A".to_string()));
    }

    #[test]
    fn parse_sse_line_done_returns_none() {
        assert_eq!(parse_sse_line("data: [DONE]"), None);
        assert_eq!(parse_sse_line("data:[DONE]"), None);
    }

    #[test]
    fn parse_sse_line_ignores_non_data_lines() {
        assert_eq!(parse_sse_line(": keep-alive"), None);
        assert_eq!(parse_sse_line("event: message"), None);
        assert_eq!(parse_sse_line(""), None);
    }

    #[test]
    fn parse_sse_line_rejects_bad_json() {
        assert_eq!(parse_sse_line("data: {not json"), None);
        // 合法 JSON 但无 choices
        assert_eq!(parse_sse_line(r#"data: {"error":"boom"}"#), None);
        // 空 choices 且无 usage
        assert_eq!(parse_sse_line(r#"data: {"choices":[]}"#), None);
        // delta 无任何内容字段
        assert_eq!(parse_sse_line(r#"data: {"choices":[{"delta":{}}]}"#), None);
    }

    #[test]
    fn parse_sse_line_extracts_finish_reason() {
        let line = r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#;
        let parsed = parse_sse_line(line).expect("应解析出 finish_reason");
        assert_eq!(parsed.finish_reason, Some("stop".to_string()));
        assert_eq!(parsed.content, None);
    }

    #[test]
    fn parse_sse_line_extracts_tool_calls() {
        let line = r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\"pa"}}]}}]}"#;
        let parsed = parse_sse_line(line).expect("应解析出 tool_calls");
        assert_eq!(parsed.tool_calls.len(), 1);
        let call = &parsed.tool_calls[0];
        assert_eq!(call.index, 0);
        assert_eq!(call.id.as_deref(), Some("call_1"));
        assert_eq!(call.name.as_deref(), Some("read_file"));
        assert_eq!(call.arguments_delta.as_deref(), Some("{\"pa"));
    }

    #[test]
    fn parse_sse_line_tool_calls_without_optional_fields() {
        // 后续增量分片通常只有 index 与 arguments
        let line = r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th"}}]}}]}"#;
        let parsed = parse_sse_line(line).expect("应解析出 tool_calls 增量");
        let call = &parsed.tool_calls[0];
        assert_eq!(call.index, 0);
        assert_eq!(call.id, None);
        assert_eq!(call.name, None);
        assert_eq!(call.arguments_delta.as_deref(), Some("th"));
    }

    #[test]
    fn parse_sse_line_extracts_usage_from_final_chunk() {
        // OpenAI 约定：开启 include_usage 后收尾分片 choices 为空数组且携带 usage
        let line = r#"data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}"#;
        let parsed = parse_sse_line(line).expect("应解析出 usage");
        assert_eq!(parsed.content, None);
        let usage = parsed.usage.expect("usage 应存在");
        assert_eq!(usage.prompt_tokens, Some(10));
        assert_eq!(usage.completion_tokens, Some(5));
        assert_eq!(usage.total_tokens, Some(15));
    }

    #[test]
    fn parse_sse_line_role_only_chunk_is_empty() {
        // 首个分片常只携带 role，无内容
        let line = r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#;
        assert_eq!(parse_sse_line(line), None);
    }

    #[test]
    fn chat_message_payload_serializes_tool_fields() {
        let message = ChatMessagePayload {
            role: "assistant".to_string(),
            content: None,
            tool_calls: Some(vec![ChatToolCallPayload {
                id: "call_1".to_string(),
                call_type: "function".to_string(),
                function: ChatToolFunctionPayload {
                    name: "read_file".to_string(),
                    arguments: r#"{"path":"src/main.rs"}"#.to_string(),
                },
            }]),
            tool_call_id: None,
        };
        let value = serde_json::to_value(&message).expect("serialize");
        assert_eq!(value["toolCalls"][0]["id"], "call_1");
        assert_eq!(value["toolCalls"][0]["type"], "function");
        assert_eq!(value["toolCalls"][0]["function"]["name"], "read_file");
        // toolCallId 缺省时不出现在 wire format；content 以 null 序列化（assistant 纯工具调用）
        assert!(value.get("toolCallId").is_none());
        assert!(value["content"].is_null());

        let back: ChatMessagePayload = serde_json::from_value(value).expect("deserialize");
        assert_eq!(back.role, "assistant");
        assert!(back.tool_calls.as_ref().expect("tool_calls").len() == 1);

        let tool_message = ChatMessagePayload {
            role: "tool".to_string(),
            content: Some("file contents".to_string()),
            tool_calls: None,
            tool_call_id: Some("call_1".to_string()),
        };
        let tool_value = serde_json::to_value(&tool_message).expect("serialize tool");
        assert_eq!(tool_value["toolCallId"], "call_1");
        assert!(tool_value.get("toolCalls").is_none());
    }
}
