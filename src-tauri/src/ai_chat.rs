//! Responses API transport for the local Agent.
//!
//! Requests share the configured network client. Text, tools, usage and
//! terminal states are delivered through `ai://responses-event`.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Notify;
use tokio::time::{timeout, Duration};

// The Agent transport is Responses-only. Legacy Chat Completions payloads are
// deliberately kept out of the runtime and are not accepted by this module.

/// 连接超时（TCP/TLS 建链）
/// 首 token 超时：请求发出到首个 SSE 数据行（推理模型首 token 慢，取宽）
const FIRST_TOKEN_TIMEOUT: Duration = Duration::from_secs(60);
/// chunk 间隔超时：流式过程中相邻数据块的最大静默间隔
const CHUNK_IDLE_TIMEOUT: Duration = Duration::from_secs(90);
/// Session-scoped cancellation flags for in-flight Responses requests.
#[derive(Default)]
pub struct AiChatState {
    requests: Mutex<RequestRegistry>,
    abort_notify: Notify,
}

#[derive(Default)]
struct RequestRegistry {
    active: HashSet<String>,
    aborts: HashSet<String>,
    early_aborts: HashMap<String, std::time::Instant>,
    finished: HashMap<String, std::time::Instant>,
}

impl RequestRegistry {
    fn prune(&mut self) {
        let expiry = Duration::from_secs(60);
        self.early_aborts.retain(|_, time| time.elapsed() < expiry);
        self.finished.retain(|_, time| time.elapsed() < expiry);
    }

    fn remember_finished(&mut self, id: &str) {
        if self.finished.len() >= 128 {
            if let Some(oldest) = self
                .finished
                .iter()
                .min_by_key(|(_, time)| *time)
                .map(|(id, _)| id.clone())
            {
                self.finished.remove(&oldest);
            }
        }
        self.finished.insert(id.into(), std::time::Instant::now());
    }
}

impl AiChatState {
    pub fn abort_all(&self) {
        if let Ok(mut requests) = self.requests.lock() {
            let active = requests.active.clone();
            requests.aborts.extend(active);
        }
        self.abort_notify.notify_waiters();
    }
    fn has_abort(&self, request_id: &str) -> bool {
        self.requests
            .lock()
            .map(|requests| requests.aborts.contains(request_id))
            .unwrap_or(true)
    }

    fn insert_abort(&self, request_id: &str) -> Result<(), String> {
        validate_request_id(request_id)?;
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| "[ai.request_state] Request registry unavailable")?;
        requests.prune();
        if requests.active.contains(request_id) {
            requests.aborts.insert(request_id.into());
            self.abort_notify.notify_waiters();
        } else if !requests.finished.contains_key(request_id) {
            if requests.early_aborts.len() >= 64 && !requests.early_aborts.contains_key(request_id)
            {
                return Err("[resource.limit] Too many pending AI cancellations".into());
            }
            requests
                .early_aborts
                .insert(request_id.into(), std::time::Instant::now());
        }
        Ok(())
    }

    async fn wait_for_abort(&self, request_id: &str) {
        loop {
            let notified = self.abort_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.has_abort(request_id) {
                return;
            }
            notified.await;
        }
    }

    fn begin_request(&self, request_id: &str) -> bool {
        if let Ok(mut requests) = self.requests.lock() {
            requests.prune();
            if requests.early_aborts.remove(request_id).is_some() {
                requests.remember_finished(request_id);
                return false;
            }
            if requests.active.len() >= crate::resource_limits::AI_REQUESTS
                || requests.active.contains(request_id)
                || requests.finished.contains_key(request_id)
            {
                return false;
            }
            requests.active.insert(request_id.to_string());
            true
        } else {
            false
        }
    }

    fn finish_request(&self, request_id: &str) {
        if let Ok(mut requests) = self.requests.lock() {
            requests.active.remove(request_id);
            requests.aborts.remove(request_id);
            requests.prune();
            requests.remember_finished(request_id);
        }
    }
}

struct RequestGuard<'a> {
    state: &'a AiChatState,
    request_id: &'a str,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        self.state.finish_request(self.request_id);
    }
}

fn response_item(value: &serde_json::Value) -> &serde_json::Value {
    value.get("item").unwrap_or(value)
}

fn response_usage(value: &serde_json::Value) -> Option<serde_json::Value> {
    let input = value
        .get("input_tokens")
        .or_else(|| value.get("prompt_tokens"));
    let output = value
        .get("output_tokens")
        .or_else(|| value.get("completion_tokens"));
    let total = value.get("total_tokens");
    let mut normalized = serde_json::Map::new();
    if let Some(value) = input {
        normalized.insert("promptTokens".into(), value.clone());
    }
    if let Some(value) = output {
        normalized.insert("completionTokens".into(), value.clone());
    }
    if let Some(value) = total {
        normalized.insert("totalTokens".into(), value.clone());
    }
    if normalized.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(normalized))
    }
}

fn nested_string<'a>(value: &'a serde_json::Value, paths: &[&[&str]]) -> Option<&'a str> {
    paths.iter().find_map(|path| {
        path.iter()
            .try_fold(value, |current, key| current.get(*key))
            .and_then(|item| item.as_str())
    })
}

/// Normalize one Responses API SSE event into a frontend-friendly event payload.
fn parse_response_sse_event_result(
    event: &str,
    data: &str,
) -> Result<Option<serde_json::Value>, String> {
    if data.trim() == "[DONE]" {
        return Ok(None);
    }
    let value: serde_json::Value = serde_json::from_str(data)
        .map_err(|error| format!("Invalid Responses SSE JSON: {error}"))?;
    let event = if event.trim().is_empty() {
        value
            .get("type")
            .and_then(|item| item.as_str())
            .unwrap_or("message")
    } else {
        event.trim()
    };
    let response = value.get("response");
    let response_id = nested_string(&value, &[&["response", "id"], &["id"]]);
    let mut payload = json!({ "type": event, "raw": value });
    if let Some(id) = response_id {
        payload["responseId"] = json!(id);
    }
    match event {
        "response.created" | "response.in_progress" => {}
        "response.output_text.delta" => {
            for (target, source) in [("itemId", "item_id"), ("outputIndex", "output_index")] {
                if let Some(item) = value.get(source) {
                    payload[target] = item.clone();
                }
            }
            if let Some(delta) = value.get("delta").and_then(|item| item.as_str()) {
                payload["delta"] = json!(delta);
            }
        }
        "response.output_text.done" => {
            for (target, source) in [("itemId", "item_id"), ("outputIndex", "output_index")] {
                if let Some(item) = value.get(source) {
                    payload[target] = item.clone();
                }
            }
            if let Some(text) = value.get("text").and_then(|item| item.as_str()) {
                payload["text"] = json!(text);
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
        "response.function_call_arguments.done" => {
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
            if let Some(arguments) = value.get("arguments").and_then(|item| item.as_str()) {
                payload["arguments"] = json!(arguments);
            }
        }
        "response.output_item.added" | "response.output_item.done" => {
            let item = response_item(&value);
            if let Some(output_index) = value.get("output_index") {
                payload["outputIndex"] = output_index.clone();
            }
            if let Some(item_id) = item.get("id").and_then(|item| item.as_str()) {
                payload["itemId"] = json!(item_id);
            }
            if let Some(call_id) = item.get("call_id").and_then(|item| item.as_str()) {
                payload["callId"] = json!(call_id);
            }
            if let Some(name) = item.get("name").and_then(|item| item.as_str()) {
                payload["name"] = json!(name);
            }
        }
        "response.completed" => {
            if let Some(reason) = nested_string(&value, &[&["response", "status"], &["status"]]) {
                payload["finishReason"] = json!(reason);
            }
            if let Some(usage) = response
                .and_then(|item| item.get("usage"))
                .or_else(|| value.get("usage"))
            {
                if let Some(normalized) = response_usage(usage) {
                    payload["usage"] = normalized;
                }
            }
        }
        "response.incomplete" | "response.failed" | "error" => {
            if let Some(reason) = nested_string(&value, &[&["response", "status"], &["status"]]) {
                payload["finishReason"] = json!(reason);
            }
            if let Some(reason) = nested_string(
                &value,
                &[
                    &["incomplete_details", "reason"],
                    &["response", "incomplete_details", "reason"],
                ],
            ) {
                payload["incompleteReason"] = json!(reason);
            }
            payload["message"] = value
                .get("message")
                .or_else(|| value.get("error").and_then(|item| item.get("message")))
                .or_else(|| {
                    value
                        .get("response")
                        .and_then(|item| item.get("error"))
                        .and_then(|item| item.get("message"))
                })
                .cloned()
                .unwrap_or_else(|| json!("Responses response did not complete"));
        }
        _ => {
            let raw = payload
                .get("raw")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            payload["rawEvent"] = json!({ "type": event, "data": raw });
        }
    }
    Ok(Some(payload))
}

/// Public compatibility wrapper used by transport tests and future adapters.
#[allow(dead_code)]
pub fn parse_response_sse_event(event: &str, data: &str) -> Option<serde_json::Value> {
    parse_response_sse_event_result(event, data).ok().flatten()
}

#[derive(Default)]
struct ResponsesSseDecoder {
    buffer: Vec<u8>,
    event: String,
    data: Vec<String>,
}

impl ResponsesSseDecoder {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<serde_json::Value>, String> {
        let mut payloads = Vec::new();
        for part in chunk.chunks(16 * 1024) {
            self.buffer.extend_from_slice(part);
            while let Some(end) = find_sse_record_end(&self.buffer) {
                if end > crate::resource_limits::AI_EVENT_BYTES {
                    return Err("SSE event exceeds 1 MiB".into());
                }
                let record: Vec<u8> = self.buffer.drain(..end).collect();
                if let Some(payload) = self.parse_record(&record)? {
                    payloads.push(payload);
                }
            }
            if self.buffer.len() > crate::resource_limits::AI_EVENT_BYTES {
                return Err("SSE buffered event exceeds 1 MiB".into());
            }
        }
        Ok(payloads)
    }

    fn finish(&mut self) -> Result<Vec<serde_json::Value>, String> {
        if self.buffer.is_empty() && self.data.is_empty() {
            return Ok(Vec::new());
        }
        let record = std::mem::take(&mut self.buffer);
        let mut payloads = Vec::new();
        if !record.is_empty() {
            if let Some(payload) = self.parse_record(&record)? {
                payloads.push(payload);
            }
        } else if let Some(payload) = self.dispatch()? {
            payloads.push(payload);
        }
        Ok(payloads)
    }

    fn parse_record(&mut self, record: &[u8]) -> Result<Option<serde_json::Value>, String> {
        let text = std::str::from_utf8(record)
            .map_err(|error| format!("Invalid UTF-8 in Responses SSE record: {error}"))?;
        for line in text.split_inclusive('\n') {
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(value) = line.strip_prefix("event:") {
                self.event = value.trim().to_string();
            } else if let Some(value) = line.strip_prefix("data:") {
                self.data
                    .push(value.strip_prefix(' ').unwrap_or(value).to_string());
            }
        }
        self.dispatch()
    }

    fn dispatch(&mut self) -> Result<Option<serde_json::Value>, String> {
        if self.data.is_empty() {
            self.event.clear();
            return Ok(None);
        }
        let event = std::mem::take(&mut self.event);
        let data = self.data.drain(..).collect::<Vec<_>>().join("\n");
        parse_response_sse_event_result(&event, &data)
    }
}

fn find_sse_record_end(buffer: &[u8]) -> Option<usize> {
    for index in 0..buffer.len().saturating_sub(1) {
        if buffer[index] == b'\n' && buffer[index + 1] == b'\n' {
            return Some(index + 2);
        }
        if index + 3 < buffer.len() && buffer[index..index + 4] == [b'\r', b'\n', b'\r', b'\n'] {
            return Some(index + 4);
        }
    }
    None
}

fn emit_response_event(app: &AppHandle, request_id: &str, mut payload: serde_json::Value) -> bool {
    let terminal = matches!(
        payload.get("type").and_then(|value| value.as_str()),
        Some("response.completed" | "response.incomplete" | "response.failed" | "error")
    );
    payload["requestId"] = json!(request_id);
    let _ = app.emit("ai://responses-event", payload);
    terminal
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
    app: AppHandle,
    state: State<'_, AiChatState>,
    profiles: State<'_, crate::ai_profiles::AiProfileState>,
    profile_id: String,
    request_id: String,
) -> Result<u16, String> {
    validate_request_id(&request_id)?;
    if !state.begin_request(&request_id) {
        return Err(
            "[ai.request_conflict] Request ID is active or the request quota is exhausted".into(),
        );
    }
    let _guard = RequestGuard {
        state: &state,
        request_id: &request_id,
    };
    let (profile, api_key, generation) = tokio::select! {
        biased;
        _ = state.wait_for_abort(&request_id) => return Err("[task.cancelled] Connection test cancelled".into()),
        result = crate::ai_profiles::resolve(&app, &profiles, &profile_id) => result?,
    };
    let client = tokio::select! {
        biased;
        _ = state.wait_for_abort(&request_id) => return Err("[task.cancelled] Connection test cancelled".into()),
        result = crate::network_policy::ai_client(&profile.base_url) => result?,
    };
    profiles.validate_grant(&app, &profile, generation)?;
    let request = client
        .post(responses_url(&profile.base_url))
        .bearer_auth(api_key.trim())
        .json(&json!({
            "model": profile.model.trim(),
            "input": [{ "role": "user", "content": [{ "type": "input_text", "text": "ping" }] }],
            "max_output_tokens": 1,
            "stream": false,
        }))
        .timeout(std::time::Duration::from_secs(15))
        .send();
    let response = tokio::select! {
        biased;
        _ = state.wait_for_abort(&request_id) => return Err("[task.cancelled] Connection test cancelled".into()),
        _ = profiles.wait_for_revocation(&app, &profile, generation) => return Err("[ai.authorization_revoked] Authorization changed".into()),
        result = request => result.map_err(|_| "[ai.connection] Responses connection failed")?,
    };
    Ok(response.status().as_u16())
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > 128
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("[ai.request_id] Invalid request ID".into());
    }
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ai_responses_send(
    app: AppHandle,
    state: State<'_, AiChatState>,
    profiles: State<'_, crate::ai_profiles::AiProfileState>,
    request_id: String,
    profile_id: String,
    instructions: Option<String>,
    input: Vec<serde_json::Value>,
    tools: Option<Vec<serde_json::Value>>,
    previous_response_id: Option<String>,
) -> Result<(), String> {
    validate_request_id(&request_id)?;
    if tools
        .as_ref()
        .is_some_and(|tools| tools.len() > crate::resource_limits::AI_TOOLS)
    {
        return Err("[resource.limit] AI tool count exceeds 64".into());
    }
    if !state.begin_request(&request_id) {
        return Err(
            "[ai.request_conflict] Request ID is active or the request quota is exhausted".into(),
        );
    }
    let _request_guard = RequestGuard {
        state: &state,
        request_id: &request_id,
    };
    if serde_json::to_vec(&json!({"input": &input, "instructions": &instructions, "tools": &tools, "previousResponseId": &previous_response_id})).map_err(|error| error.to_string())?.len() > crate::resource_limits::AI_REQUEST_BYTES {
        return Err("[resource.limit] AI request exceeds 4 MiB".into());
    }
    let (profile, api_key, generation) = tokio::select! {
        _ = state.wait_for_abort(&request_id) => {
            emit_response_event(&app, &request_id, json!({"type":"response.failed","message":"aborted"}));
            return Ok(());
        }
        resolved = crate::ai_profiles::resolve(&app, &profiles, &profile_id) => resolved?,
    };
    let base_url = &profile.base_url;
    let model = &profile.model;
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
    if serde_json::to_vec(&body)
        .map_err(|error| error.to_string())?
        .len()
        > crate::resource_limits::AI_REQUEST_BYTES
    {
        return Err("[resource.limit] AI request exceeds 4 MiB".into());
    }
    let client_result = tokio::select! {
        _ = profiles.wait_for_revocation(&app, &profile, generation) => return Err("[ai.authorization_revoked] Authorization changed".into()),
        _ = state.wait_for_abort(&request_id) => {
            emit_response_event(&app, &request_id, json!({"type":"response.failed","message":"aborted"}));
            return Ok(());
        }
        result = crate::network_policy::ai_client(base_url) => result,
    };
    let client = match client_result {
        Ok(client) => client,
        Err(message) => {
            let _ = app.emit(
                "ai://responses-event",
                json!({ "requestId": request_id, "type": "error", "code": "generic", "message": message }),
            );
            return Ok(());
        }
    };
    profiles.validate_grant(&app, &profile, generation)?;
    let request = client
        .post(responses_url(base_url))
        .bearer_auth(api_key.trim())
        .json(&body);
    let response = tokio::select! {
        _ = profiles.wait_for_revocation(&app, &profile, generation) => return Err("[ai.authorization_revoked] Authorization changed".into()),
        _ = state.wait_for_abort(&request_id) => {
            let _ = app.emit(
                "ai://responses-event",
                json!({ "requestId": request_id, "type": "response.failed", "message": "aborted" }),
            );
            return Ok(());
        }
        result = timeout(FIRST_TOKEN_TIMEOUT, request.send()) => match result {
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
        }
    };
    if !response.status().is_success() {
        let status = response.status();
        let code = match status.as_u16() {
            401 | 403 => "auth",
            429 => "rate_limit",
            _ => "generic",
        };
        let _ = app.emit(
            "ai://responses-event",
            json!({ "requestId": request_id, "type": "error", "code": code, "message": format!("AI endpoint returned HTTP {}", status.as_u16()) }),
        );
        return Ok(());
    }
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut decoder = ResponsesSseDecoder::default();
    let mut received_event = false;
    let mut terminal_event_received = false;
    let mut output_bytes = 0usize;
    loop {
        let wait = if received_event {
            CHUNK_IDLE_TIMEOUT
        } else {
            FIRST_TOKEN_TIMEOUT
        };
        let next = tokio::select! {
            _ = profiles.wait_for_revocation(&app, &profile, generation) => return Err("[ai.authorization_revoked] Authorization changed".into()),
            _ = state.wait_for_abort(&request_id) => {
                let _ = app.emit(
                    "ai://responses-event",
                    json!({ "requestId": request_id, "type": "response.failed", "message": "aborted" }),
                );
                return Ok(());
            }
            result = timeout(wait, stream.next()) => result,
        };
        match next {
            Ok(Some(Ok(chunk))) => {
                output_bytes = output_bytes.saturating_add(chunk.len());
                if output_bytes > crate::resource_limits::AI_OUTPUT_BYTES {
                    emit_response_event(
                        &app,
                        &request_id,
                        json!({"type":"error","code":"invalid_stream","message":"AI output exceeds 32 MiB"}),
                    );
                    return Ok(());
                }
                let payloads = match decoder.push(&chunk) {
                    Ok(payloads) => payloads,
                    Err(message) => {
                        let _ = app.emit(
                            "ai://responses-event",
                            json!({ "requestId": request_id, "type": "error", "code": "invalid_stream", "message": message }),
                        );
                        return Ok(());
                    }
                };
                for payload in payloads {
                    received_event = true;
                    terminal_event_received |= emit_response_event(&app, &request_id, payload);
                    if terminal_event_received {
                        return Ok(());
                    }
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
            Ok(None) => {
                let payloads = match decoder.finish() {
                    Ok(payloads) => payloads,
                    Err(message) => {
                        let _ = app.emit(
                            "ai://responses-event",
                            json!({ "requestId": request_id, "type": "error", "code": "invalid_stream", "message": message }),
                        );
                        return Ok(());
                    }
                };
                for payload in payloads {
                    received_event = true;
                    terminal_event_received |= emit_response_event(&app, &request_id, payload);
                }
                if !received_event {
                    emit_response_event(
                        &app,
                        &request_id,
                        json!({
                            "type": "error",
                            "code": "empty_stream",
                            "message": "Responses stream ended before sending an event"
                        }),
                    );
                } else if !terminal_event_received {
                    emit_response_event(
                        &app,
                        &request_id,
                        json!({
                            "type": "error",
                            "code": "incomplete_stream",
                            "message": "Responses stream ended without a terminal event"
                        }),
                    );
                }
                return Ok(());
            }
            Err(_) => {
                let _ = app.emit(
                    "ai://responses-event",
                    json!({ "requestId": request_id, "type": "error", "code": if received_event { "idle_timeout" } else { "first_token_timeout" }, "message": "Responses stream timeout" }),
                );
                return Ok(());
            }
        }
    }
}

#[tauri::command]
pub fn ai_responses_abort(state: State<'_, AiChatState>, request_id: String) -> Result<(), String> {
    state.insert_abort(&request_id)
}

#[cfg(test)]
mod responses_tests {
    use super::*;
    use std::sync::Arc;

    fn decode(decoder: &mut ResponsesSseDecoder, text: &str) -> Vec<serde_json::Value> {
        decoder.push(text.as_bytes()).expect("SSE should decode")
    }

    #[test]
    fn parses_text_delta_and_response_id() {
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
    fn parses_function_delta_and_completed_usage() {
        let delta = parse_response_sse_event(
            "response.function_call_arguments.delta",
            r#"{"item_id":"item_1","call_id":"call_1","output_index":0,"name":"read_file","delta":"{\"path\":"}"#,
        )
        .expect("function argument delta should parse");
        assert_eq!(delta["callId"], "call_1");
        assert_eq!(delta["argumentsDelta"], "{\"path\":");

        let completed = parse_response_sse_event(
            "response.completed",
            r#"{"response":{"id":"resp_2","status":"completed","usage":{"input_tokens":4,"output_tokens":2}}}"#,
        )
        .expect("completed event should parse");
        assert_eq!(completed["finishReason"], "completed");
        assert_eq!(completed["usage"]["promptTokens"], 4);
        assert_eq!(completed["usage"]["completionTokens"], 2);
        assert_eq!(completed["raw"]["response"]["usage"]["input_tokens"], 4);
    }

    #[test]
    fn parses_response_lifecycle_and_done_events() {
        let created = parse_response_sse_event(
            "response.created",
            r#"{"response":{"id":"resp_3","status":"in_progress"}}"#,
        )
        .expect("created event should parse");
        assert_eq!(created["responseId"], "resp_3");

        let text = parse_response_sse_event(
            "response.output_text.done",
            r#"{"item_id":"msg_1","output_index":0,"text":"done"}"#,
        )
        .expect("text done event should parse");
        assert_eq!(text["itemId"], "msg_1");
        assert_eq!(text["text"], "done");

        let arguments = parse_response_sse_event(
            "response.function_call_arguments.done",
            r#"{"item_id":"item_1","call_id":"call_1","name":"read_file","output_index":0,"arguments":"{\"path\":\"src/lib.rs\"}"}"#,
        )
        .expect("function arguments done event should parse");
        assert_eq!(arguments["callId"], "call_1");
        assert_eq!(arguments["itemId"], "item_1");
        assert_eq!(arguments["outputIndex"], 0);
        assert_eq!(arguments["name"], "read_file");
        assert_eq!(arguments["arguments"], "{\"path\":\"src/lib.rs\"}");

        let added = parse_response_sse_event(
            "response.output_item.added",
            r#"{"output_index":0,"item":{"id":"item_1","type":"function_call","call_id":"call_1","name":"read_file"}}"#,
        )
        .expect("output item added event should parse");
        assert_eq!(added["outputIndex"], 0);
        assert_eq!(added["itemId"], "item_1");
        assert_eq!(added["callId"], "call_1");
        assert_eq!(added["name"], "read_file");
        assert_eq!(added["raw"]["item"]["type"], "function_call");

        let incomplete = parse_response_sse_event(
            "response.incomplete",
            r#"{"response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"error":{"message":"token limit"}}}"#,
        )
        .expect("incomplete event should parse");
        assert_eq!(incomplete["finishReason"], "incomplete");
        assert_eq!(incomplete["incompleteReason"], "max_output_tokens");
        assert_eq!(incomplete["message"], "token limit");
    }

    #[test]
    fn preserves_unknown_events_for_forward_compatibility() {
        let payload = parse_response_sse_event("response.future_event", r#"{"value":42}"#)
            .expect("unknown event should still be forwarded");
        assert_eq!(payload["type"], "response.future_event");
        assert_eq!(payload["rawEvent"]["type"], "response.future_event");
        assert_eq!(payload["rawEvent"]["data"]["value"], 42);
    }

    #[test]
    fn decodes_lf_crlf_and_final_record_without_newline() {
        let mut decoder = ResponsesSseDecoder::default();
        let payload = decode(
            &mut decoder,
            "event: response.output_text.delta\r\ndata: {\"delta\":\"tail\"}\r\n\r\n",
        )
        .pop()
        .expect("CRLF record should parse");
        assert_eq!(payload["delta"], "tail");

        let payload = decode(
            &mut decoder,
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"last\"}",
        )
        .into_iter()
        .chain(decoder.finish().expect("final record should flush"))
        .last()
        .expect("final LF-less record should parse");
        assert_eq!(payload["delta"], "last");
    }

    #[test]
    fn handles_utf8_split_multiline_data_and_event_reset() {
        let mut decoder = ResponsesSseDecoder::default();
        let record = "event: response.output_text.delta\ndata: {\"delta\":\n";
        assert!(decode(&mut decoder, record).is_empty());
        let tail = "data: \"你好\"}\n\n";
        let bytes = tail.as_bytes();
        let split = tail.find('好').expect("UTF-8 text") + 1;
        assert!(decoder
            .push(&bytes[..split])
            .expect("split UTF-8 should wait")
            .is_empty());
        let payload = decoder
            .push(&bytes[split..])
            .expect("multiline UTF-8 record should parse")
            .pop()
            .expect("multiline UTF-8 record should emit");
        assert_eq!(payload["delta"], "你好");
        assert!(bytes.len() > split);

        let payload = decode(
            &mut decoder,
            "data: {\"type\":\"response.output_text.done\",\"text\":\"done\"}\n\n",
        )
        .pop()
        .expect("event type should reset between records");
        assert_eq!(payload["type"], "response.output_text.done");
    }

    #[test]
    fn defaults_missing_event_name_to_message() {
        let mut decoder = ResponsesSseDecoder::default();
        let payload = decode(&mut decoder, "data: {\"value\":42}\n\n")
            .pop()
            .expect("event without type should parse");
        assert_eq!(payload["type"], "message");
    }

    #[test]
    fn invalid_utf8_is_rejected_only_when_record_is_complete() {
        let mut decoder = ResponsesSseDecoder::default();
        assert!(decoder
            .push(b"data: \xE4")
            .expect("incomplete record should wait")
            .is_empty());
        let error = decoder
            .push(b"\n\n")
            .expect_err("invalid UTF-8 should fail");
        assert!(error.contains("Invalid UTF-8"));
    }

    #[test]
    fn nonterminal_stream_finish_does_not_synthesize_completion() {
        let mut decoder = ResponsesSseDecoder::default();
        let events = decode(
            &mut decoder,
            "event: response.created\ndata: {\"response\":{\"id\":\"resp_1\"}}\n\n",
        );
        assert_eq!(events.len(), 1);
        assert_ne!(events[0]["type"], "response.completed");
        let tail = decoder.finish().expect("stream finish should succeed");
        assert!(tail.is_empty());
    }

    #[test]
    fn rejects_a_large_sse_record_but_accepts_many_small_coalesced_records() {
        let mut decoder = ResponsesSseDecoder::default();
        assert!(decoder
            .push(&vec![b'x'; crate::resource_limits::AI_EVENT_BYTES + 1])
            .is_err());
        let record = "data: {\"delta\":\"hello\"}\n\n";
        let mut decoder = ResponsesSseDecoder::default();
        assert_eq!(
            decoder
                .push(record.repeat(50_000).as_bytes())
                .unwrap()
                .len(),
            50_000
        );
    }

    #[test]
    fn duplicate_request_and_completed_abort_do_not_leak_registry_entries() {
        let state = AiChatState::default();
        assert!(state.begin_request("one"));
        assert!(!state.begin_request("one"));
        {
            let _guard = RequestGuard {
                state: &state,
                request_id: "one",
            };
            state.insert_abort("one").unwrap();
        }
        state.insert_abort("one").unwrap();
        let requests = state.requests.lock().unwrap();
        assert!(requests.active.is_empty());
        assert!(requests.aborts.is_empty());
        assert!(requests.early_aborts.is_empty());
    }

    #[test]
    fn chat_and_connection_tests_share_the_request_quota_and_validate_ids() {
        for id in ["", "with space", "../invalid", &"x".repeat(129)] {
            assert!(validate_request_id(id).is_err());
        }
        assert!(validate_request_id("test-123.request").is_ok());
        let state = AiChatState::default();
        for index in 0..crate::resource_limits::AI_REQUESTS {
            assert!(state.begin_request(&format!("request-{index}")));
        }
        assert!(!state.begin_request("connection-test"));
        state.finish_request("request-0");
        assert!(state.begin_request("connection-test"));
        state.finish_request("connection-test");
        for index in 1..crate::resource_limits::AI_REQUESTS {
            state.finish_request(&format!("request-{index}"));
        }
        assert!(state.requests.lock().unwrap().active.is_empty());
    }

    #[tokio::test]
    async fn abort_notification_wakes_waiter_promptly() {
        let state = Arc::new(AiChatState::default());
        assert!(state.begin_request("request-1"));
        let waiter_state = Arc::clone(&state);
        let waiter = tokio::spawn(async move {
            waiter_state.wait_for_abort("request-1").await;
        });
        state.insert_abort("request-1").unwrap();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("abort should wake the request")
            .expect("waiter should finish");
    }

    #[test]
    fn early_cancellation_is_atomic_bounded_and_expires() {
        let state = AiChatState::default();
        state.insert_abort("early").unwrap();
        assert!(!state.begin_request("early"));
        assert!(!state.begin_request("early"));
        assert!(state.requests.lock().unwrap().active.is_empty());
        for index in 0..64 {
            state.insert_abort(&format!("unknown-{index}")).unwrap();
        }
        assert!(state.insert_abort("overflow").is_err());
        assert!(state.insert_abort("../bad").is_err());
        let expired = std::time::Instant::now() - Duration::from_secs(61);
        state
            .requests
            .lock()
            .unwrap()
            .early_aborts
            .insert("unknown-0".into(), expired);
        assert!(state.begin_request("unknown-0"));
        state.finish_request("unknown-0");
        for index in 0..1000 {
            state.finish_request(&format!("done-{index}"));
        }
        assert!(state.requests.lock().unwrap().finished.len() <= 128);
    }
}
