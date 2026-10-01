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

#[cfg(test)]
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::time::{timeout, Duration};

/// 连接超时（TCP/TLS 建链）
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// 首 token 超时：请求发出到首个 SSE 数据行（推理模型首 token 慢，取宽）
const FIRST_TOKEN_TIMEOUT: Duration = Duration::from_secs(60);
/// chunk 间隔超时：流式过程中相邻数据块的最大静默间隔
const CHUNK_IDLE_TIMEOUT: Duration = Duration::from_secs(90);
/// Session-scoped cancellation flags for in-flight Responses requests.
#[derive(Default)]
pub struct AiChatState {
    aborts: Mutex<HashSet<String>>,
}

impl AiChatState {
    fn has_abort(&self, request_id: &str) -> bool {
        self.aborts
            .lock()
            .map(|set| set.contains(request_id))
            .unwrap_or(false)
    }

    fn clear_abort(&self, request_id: &str) {
        if let Ok(mut set) = self.aborts.lock() {
            set.remove(request_id);
        }
    }

    fn insert_abort(&self, request_id: &str) {
        if let Ok(mut set) = self.aborts.lock() {
            set.insert(request_id.to_string());
        }
    }
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolFunctionPayload {
    pub name: String,
    pub arguments: String,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolCallPayload {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: ChatToolFunctionPayload,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessagePayload {
    pub role: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(
        rename = "tool_calls",
        alias = "toolCalls",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub tool_calls: Option<Vec<ChatToolCallPayload>>,
    #[serde(
        rename = "tool_call_id",
        alias = "toolCallId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub tool_call_id: Option<String>,
}

#[cfg(test)]
#[derive(Debug, Default, PartialEq, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SseUsage {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

#[cfg(test)]
#[derive(Debug, Default, PartialEq, Serialize, Clone)]
pub struct SseToolCallDelta {
    pub index: u64,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments_delta: Option<String>,
}

#[cfg(test)]
#[derive(Debug, Default, PartialEq)]
pub struct SseLine {
    pub content: Option<String>,
    pub finish_reason: Option<String>,
    pub tool_calls: Vec<SseToolCallDelta>,
    pub usage: Option<SseUsage>,
}

#[cfg(test)]
impl SseLine {
    fn is_empty(&self) -> bool {
        self.content.is_none()
            && self.finish_reason.is_none()
            && self.tool_calls.is_empty()
            && self.usage.is_none()
    }
}

#[cfg(test)]
pub fn parse_sse_line(line: &str) -> Option<SseLine> {
    let data = line.trim_start().strip_prefix("data:")?.trim_start();
    if data == "[DONE]" {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    let first = value.get("choices").and_then(|choices| choices.get(0));
    let delta = first.and_then(|choice| choice.get("delta"));
    let content = delta
        .and_then(|item| item.get("content"))
        .and_then(|item| item.as_str())
        .map(str::to_string);
    let finish_reason = first
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(|item| item.as_str())
        .map(str::to_string);
    let tool_calls = delta
        .and_then(|item| item.get("tool_calls"))
        .and_then(|item| item.as_array())
        .map(|calls| {
            calls
                .iter()
                .map(|call| {
                    let function = call.get("function");
                    SseToolCallDelta {
                        index: call
                            .get("index")
                            .and_then(|item| item.as_u64())
                            .unwrap_or(0),
                        id: call
                            .get("id")
                            .and_then(|item| item.as_str())
                            .map(str::to_string),
                        name: function
                            .and_then(|item| item.get("name"))
                            .and_then(|item| item.as_str())
                            .map(str::to_string),
                        arguments_delta: function
                            .and_then(|item| item.get("arguments"))
                            .and_then(|item| item.as_str())
                            .map(str::to_string),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    let usage = value
        .get("usage")
        .and_then(|item| item.as_object())
        .map(|item| SseUsage {
            prompt_tokens: item.get("prompt_tokens").and_then(|value| value.as_u64()),
            completion_tokens: item
                .get("completion_tokens")
                .and_then(|value| value.as_u64()),
            total_tokens: item.get("total_tokens").and_then(|value| value.as_u64()),
        });
    let parsed = SseLine {
        content,
        finish_reason,
        tool_calls,
        usage,
    };
    (!parsed.is_empty()).then_some(parsed)
}

/// Normalize one Responses API SSE event into a frontend-friendly event payload.
pub fn parse_response_sse_event(event: &str, data: &str) -> Option<serde_json::Value> {
    if data.trim() == "[DONE]" {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    let response = value.get("response");
    let response_id = response
        .and_then(|item| item.get("id"))
        .and_then(|item| item.as_str())
        .or_else(|| value.get("id").and_then(|item| item.as_str()));
    let mut payload = json!({ "type": event });
    if let Some(id) = response_id {
        payload["responseId"] = json!(id);
    }
    match event {
        "response.output_text.delta" => {
            if let Some(delta) = value.get("delta").and_then(|item| item.as_str()) {
                payload["delta"] = json!(delta);
            }
        }
        "response.function_call_arguments.delta" => {
            for (target, source) in [
                ("callId", "call_id"),
                ("itemId", "item_id"),
                ("outputIndex", "output_index"),
            ] {
                if let Some(item) = value.get(source) {
                    payload[target] = item.clone();
                }
            }
            if let Some(name) = value.get("name").and_then(|item| item.as_str()) {
                payload["name"] = json!(name);
            }
            if let Some(delta) = value.get("delta").and_then(|item| item.as_str()) {
                payload["argumentsDelta"] = json!(delta);
            }
        }
        "response.output_item.done" => {
            payload["raw"] = value.clone();
            let item = value.get("item").unwrap_or(&value);
            if let Some(call_id) = item.get("call_id").and_then(|item| item.as_str()) {
                payload["callId"] = json!(call_id);
            }
            if let Some(name) = item.get("name").and_then(|item| item.as_str()) {
                payload["name"] = json!(name);
            }
        }
        "response.completed" => {
            if let Some(reason) = value
                .get("response")
                .and_then(|item| item.get("status"))
                .and_then(|item| item.as_str())
            {
                payload["finishReason"] = json!(reason);
            }
            if let Some(usage) = response.and_then(|item| item.get("usage")) {
                payload["usage"] = usage.clone();
            }
        }
        "response.failed" | "error" => {
            payload["message"] = value
                .get("message")
                .or_else(|| value.get("error").and_then(|item| item.get("message")))
                .cloned()
                .unwrap_or_else(|| json!("Responses request failed"));
        }
        _ => {
            payload["raw"] = value;
        }
    }
    Some(payload)
}

fn responses_url(base_url: &str) -> String {
    format!("{}/responses", base_url.trim().trim_end_matches('/'))
}

/// Map reqwest failures to stable error codes consumed by the frontend.
fn classify_request_error(error: &reqwest::Error) -> (&'static str, String) {
    if error.is_connect() {
        ("connect", format!("Connection failed: {error}"))
    } else if error.is_timeout() {
        ("timeout", format!("Request timed out: {error}"))
    } else {
        ("generic", error.to_string())
    }
}

#[tauri::command]
pub async fn ai_test_responses_connection(
    base_url: String,
    api_key: String,
    model: String,
) -> Result<u16, String> {
    let client = crate::network::configure_client(
        reqwest::Client::builder().connect_timeout(CONNECT_TIMEOUT),
    )?;
    let response = client
        .post(responses_url(&base_url))
        .bearer_auth(api_key.trim())
        .json(&json!({
            "model": model.trim(),
            "input": [{ "role": "user", "content": [{ "type": "input_text", "text": "ping" }] }],
            "max_output_tokens": 1,
            "stream": false,
        }))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| format!("Responses connection failed: {error}"))?;
    Ok(response.status().as_u16())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_responses_send(
    app: AppHandle,
    state: State<'_, AiChatState>,
    request_id: String,
    base_url: String,
    api_key: String,
    model: String,
    instructions: Option<String>,
    input: Vec<serde_json::Value>,
    tools: Option<Vec<serde_json::Value>>,
    previous_response_id: Option<String>,
) -> Result<(), String> {
    if state.has_abort(&request_id) {
        state.clear_abort(&request_id);
        let _ = app.emit(
            "ai://responses-event",
            json!({ "requestId": request_id, "type": "response.failed", "message": "aborted" }),
        );
        return Ok(());
    }
    let mut body = json!({
        "model": model,
        "input": input,
        "stream": true,
    });
    if let Some(instructions) = instructions {
        body["instructions"] = json!(instructions);
    }
    if let Some(tools) = tools {
        body["tools"] = json!(tools);
    }
    if let Some(previous_response_id) = previous_response_id {
        body["previous_response_id"] = json!(previous_response_id);
    }
    let client = match crate::network::configure_client(
        reqwest::Client::builder().connect_timeout(CONNECT_TIMEOUT),
    ) {
        Ok(client) => client,
        Err(message) => {
            let _ = app.emit(
                "ai://responses-event",
                json!({ "requestId": request_id, "type": "error", "code": "generic", "message": message }),
            );
            return Ok(());
        }
    };
    let request = client
        .post(responses_url(&base_url))
        .bearer_auth(api_key.trim())
        .json(&body);
    let response = match timeout(FIRST_TOKEN_TIMEOUT, request.send()).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => {
            let (code, message) = classify_request_error(&error);
            let _ = app.emit(
                "ai://responses-event",
                json!({ "requestId": request_id, "type": "error", "code": code, "message": message }),
            );
            return Ok(());
        }
        Err(_) => {
            let _ = app.emit(
                "ai://responses-event",
                json!({ "requestId": request_id, "type": "error", "code": "first_token_timeout", "message": "Responses first token timeout" }),
            );
            return Ok(());
        }
    };
    if !response.status().is_success() {
        let status = response.status();
        let code = match status.as_u16() {
            401 | 403 => "auth",
            429 => "rate_limit",
            _ => "generic",
        };
        let detail = response
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(300)
            .collect::<String>();
        let _ = app.emit(
            "ai://responses-event",
            json!({ "requestId": request_id, "type": "error", "code": code, "message": format!("HTTP {}: {detail}", status.as_u16()) }),
        );
        return Ok(());
    }
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut current_event = String::new();
    let mut received_data = false;
    loop {
        if state.has_abort(&request_id) {
            state.clear_abort(&request_id);
            let _ = app.emit(
                "ai://responses-event",
                json!({ "requestId": request_id, "type": "response.failed", "message": "aborted" }),
            );
            return Ok(());
        }
        let wait = if received_data {
            CHUNK_IDLE_TIMEOUT
        } else {
            FIRST_TOKEN_TIMEOUT
        };
        match timeout(wait, stream.next()).await {
            Ok(Some(Ok(chunk))) => {
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(position) = buffer.find('\n') {
                    let line: String = buffer.drain(..position + 1).collect();
                    let line = line.trim_end_matches(['\r', '\n']);
                    if let Some(value) = line.strip_prefix("event:") {
                        current_event = value.trim().to_string();
                        continue;
                    }
                    let Some(value) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let Some(mut payload) = parse_response_sse_event(&current_event, value.trim())
                    else {
                        continue;
                    };
                    payload["requestId"] = json!(&request_id);
                    received_data = true;
                    let _ = app.emit("ai://responses-event", payload);
                }
            }
            Ok(Some(Err(error))) => {
                let (code, message) = classify_request_error(&error);
                let _ = app.emit(
                    "ai://responses-event",
                    json!({ "requestId": request_id, "type": "error", "code": code, "message": message }),
                );
                return Ok(());
            }
            Ok(None) => return Ok(()),
            Err(_) => {
                let _ = app.emit(
                    "ai://responses-event",
                    json!({ "requestId": request_id, "type": "error", "code": if received_data { "idle_timeout" } else { "first_token_timeout" }, "message": "Responses stream timeout" }),
                );
                return Ok(());
            }
        }
    }
}

#[tauri::command]
pub fn ai_responses_abort(state: State<'_, AiChatState>, request_id: String) -> Result<(), String> {
    state.insert_abort(&request_id);
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
    fn parse_responses_text_delta_and_response_id() {
        let payload = parse_response_sse_event(
            "response.output_text.delta",
            r#"{"response":{"id":"resp_1"},"delta":"hello"}"#,
        )
        .expect("Responses delta should parse");
        assert_eq!(payload["type"], "response.output_text.delta");
        assert_eq!(payload["responseId"], "resp_1");
        assert_eq!(payload["delta"], "hello");
    }

    #[test]
    fn parse_responses_function_delta_and_output_item() {
        let delta = parse_response_sse_event(
            "response.function_call_arguments.delta",
            r#"{"item_id":"item_1","call_id":"call_1","output_index":0,"name":"read_file","delta":"{\"path\":"}"#,
        )
        .expect("function argument delta should parse");
        assert_eq!(delta["callId"], "call_1");
        assert_eq!(delta["itemId"], "item_1");
        assert_eq!(delta["outputIndex"], 0);
        assert_eq!(delta["argumentsDelta"], "{\"path\":");

        let done = parse_response_sse_event(
            "response.output_item.done",
            r#"{"item":{"type":"function_call","call_id":"call_1","name":"read_file","arguments":"{}"}}"#,
        )
        .expect("function output item should parse");
        assert_eq!(done["callId"], "call_1");
        assert_eq!(done["name"], "read_file");
        assert_eq!(done["raw"]["item"]["type"], "function_call");
    }

    #[test]
    fn parse_responses_completed_usage_and_errors() {
        let completed = parse_response_sse_event(
            "response.completed",
            r#"{"response":{"id":"resp_2","status":"completed","usage":{"input_tokens":4,"output_tokens":2}}}"#,
        )
        .expect("completed event should parse");
        assert_eq!(completed["finishReason"], "completed");
        assert_eq!(completed["usage"]["input_tokens"], 4);

        let error = parse_response_sse_event("error", r#"{"error":{"message":"bad request"}}"#)
            .expect("error event should parse");
        assert_eq!(error["message"], "bad request");
        assert!(parse_response_sse_event("message", "[DONE]").is_none());
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
        assert_eq!(value["tool_calls"][0]["id"], "call_1");
        assert_eq!(value["tool_calls"][0]["type"], "function");
        assert_eq!(value["tool_calls"][0]["function"]["name"], "read_file");
        // toolCallId 缺省时不出现在 wire format；content 以 null 序列化（assistant 纯工具调用）
        assert!(value.get("tool_call_id").is_none());
        assert!(value["content"].is_null());

        let back: ChatMessagePayload = serde_json::from_value(value).expect("deserialize wire");
        assert_eq!(back.role, "assistant");
        assert!(back.tool_calls.as_ref().expect("tool_calls").len() == 1);

        let frontend_value = serde_json::json!({
            "role": "assistant",
            "content": null,
            "toolCalls": [{
                "id": "call_2",
                "type": "function",
                "function": { "name": "list_dir", "arguments": "{}" }
            }]
        });
        let frontend: ChatMessagePayload =
            serde_json::from_value(frontend_value).expect("deserialize frontend payload");
        assert_eq!(
            frontend.tool_calls.as_ref().expect("tool calls")[0].id,
            "call_2"
        );

        let tool_message = ChatMessagePayload {
            role: "tool".to_string(),
            content: Some("file contents".to_string()),
            tool_calls: None,
            tool_call_id: Some("call_1".to_string()),
        };
        let tool_value = serde_json::to_value(&tool_message).expect("serialize tool");
        assert_eq!(tool_value["tool_call_id"], "call_1");
        assert!(tool_value.get("tool_calls").is_none());

        let frontend_tool = serde_json::json!({
            "role": "tool",
            "content": "file contents",
            "toolCallId": "call_2"
        });
        let parsed_frontend_tool: ChatMessagePayload =
            serde_json::from_value(frontend_tool).expect("deserialize frontend tool result");
        assert_eq!(parsed_frontend_tool.tool_call_id.as_deref(), Some("call_2"));
    }
}
