use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const RESPONSE_BYTES: usize = 4 * 1024 * 1024;
#[derive(Default)]
pub struct MarketplaceState {
    origins: Mutex<HashSet<(String, u64)>>,
    active: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
}

impl MarketplaceState {
    pub fn clear(&self) {
        if let Ok(mut origins) = self.origins.lock() {
            origins.clear();
        }
        if let Ok(mut active) = self.active.lock() {
            for (_, request) in active.drain() {
                request.notify_one();
            }
        }
    }
}

struct RequestGuard<'a> {
    state: &'a MarketplaceState,
    id: String,
}
impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.state.active.lock() {
            active.remove(&self.id);
        }
    }
}

fn url(raw: &str) -> Result<url::Url, String> {
    if raw.len() > 8192 {
        return Err("[resource.limit] Marketplace URL exceeds limit".into());
    }
    let url = url::Url::parse(raw).map_err(|_| "[marketplace.url] Invalid URL")?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("[marketplace.url] URL userinfo and fragment are prohibited".into());
    }
    let host = url.host_str().ok_or("[marketplace.url] Missing host")?;
    let loopback = host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if !(url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && matches!(
            host,
            "marketplace.aurona.cc" | "account.aurona.cc" | "auth.aurona.cc"
        )
        || (loopback && matches!(url.scheme(), "http" | "https")))
    {
        return Err("[marketplace.source] Marketplace resources require an official or authorized loopback source".into());
    }
    Ok(url)
}

pub fn catalog_source(raw: &str) -> Result<String, String> {
    Ok(url(raw)?.origin().ascii_serialization())
}

async fn authorize(
    app: &tauri::AppHandle,
    state: &MarketplaceState,
    url: &url::Url,
) -> Result<u64, String> {
    let generation = app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation();
    let origin = url.origin().ascii_serialization();
    if url.scheme() == "https" && url.host_str() == Some("marketplace.aurona.cc") {
        return Ok(generation);
    }
    if state
        .origins
        .lock()
        .map_err(|_| "[marketplace.authorization] Registry unavailable")?
        .contains(&(origin.clone(), generation))
    {
        return Ok(generation);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let (title, body) =
        crate::authorization_dialogs::text(app, "marketplace", &[("origin", &origin)]);
    app.dialog()
        .message(body)
        .title(title)
        .buttons(MessageDialogButtons::YesNo)
        .show(move |approved| {
            let _ = sender.send(approved);
        });
    if !matches!(
        tokio::time::timeout(Duration::from_secs(60), receiver).await,
        Ok(Ok(true))
    ) {
        return Err("[marketplace.denied] Source was not authorized".into());
    }
    if app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation()
        != generation
    {
        return Err("[workspace.generation] Workspace changed during source approval".into());
    }
    let mut entries = state
        .origins
        .lock()
        .map_err(|_| "[marketplace.authorization] Registry unavailable")?;
    entries.retain(|(_, current)| *current == generation);
    if entries.len() >= 16 {
        return Err("[resource.limit] Marketplace source quota reached".into());
    }
    entries.insert((origin, generation));
    Ok(generation)
}

fn validate_json(value: &serde_json::Value, depth: usize, nodes: &mut usize) -> Result<(), String> {
    *nodes += 1;
    if depth > 32 || *nodes > 100_000 {
        return Err("[marketplace.schema] Response complexity exceeds limit".into());
    }
    match value {
        serde_json::Value::Array(values) => {
            if values.len() > 1000 {
                return Err(
                    "[marketplace.schema] Response has more than 1000 entries; use pagination"
                        .into(),
                );
            }
            for value in values {
                validate_json(value, depth + 1, nodes)?;
            }
        }
        serde_json::Value::Object(values) => {
            if values.len() > 128 {
                return Err("[marketplace.schema] Too many fields".into());
            }
            for (key, value) in values {
                if key.len() > 256 {
                    return Err("[marketplace.schema] Field name exceeds limit".into());
                }
                validate_json(value, depth + 1, nodes)?;
            }
        }
        serde_json::Value::String(value) if value.len() > 1024 * 1024 => {
            return Err("[marketplace.schema] Field exceeds 1 MiB".into())
        }
        _ => {}
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub request_id: String,
    pub url: String,
    pub method: String,
    pub body: Option<String>,
    pub headers: HashMap<String, String>,
}
#[derive(Serialize)]
pub struct Response {
    status: u16,
    body: String,
    catalog_verified: bool,
}

#[tauri::command]
pub async fn marketplace_request(
    app: tauri::AppHandle,
    state: State<'_, MarketplaceState>,
    request: Request,
) -> Result<Response, String> {
    if request.request_id.is_empty()
        || request.request_id.len() > 128
        || request.headers.len() > 8
        || request
            .body
            .as_ref()
            .is_some_and(|body| body.len() > RESPONSE_BYTES)
    {
        return Err("[resource.limit] Marketplace request exceeds limit".into());
    }
    let url = url(&request.url)?;
    if url.path().ends_with("/auth/token-exchange")
        && url.origin().ascii_serialization() != "https://marketplace.aurona.cc"
    {
        return Err(
            "[marketplace.credentials] Token exchange requires the official HTTPS origin".into(),
        );
    }
    if url.host_str() != Some("marketplace.aurona.cc")
        && request
            .headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case("authorization"))
    {
        return Err(
            "[marketplace.credentials] Account credentials may only reach the official Marketplace"
                .into(),
        );
    }
    let method = match request.method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("[marketplace.method] Method is not allowed".into()),
    };
    let abort = Arc::new(tokio::sync::Notify::new());
    {
        let mut active = state
            .active
            .lock()
            .map_err(|_| "[marketplace.request] Registry unavailable")?;
        if active.len() >= 4 || active.contains_key(&request.request_id) {
            return Err("[resource.limit] Marketplace request quota or ID conflict".into());
        }
        active.insert(request.request_id.clone(), abort.clone());
    }
    let _guard = RequestGuard {
        state: &state,
        id: request.request_id.clone(),
    };
    let work = async {
        let generation = authorize(&app, &state, &url).await?;
        let client = crate::network_policy::pinned_client(&url).await?;
        let mut builder = client
            .request(method, url.clone())
            .timeout(Duration::from_secs(30));
        for (key, value) in request.headers {
            if !matches!(
                key.to_ascii_lowercase().as_str(),
                "authorization" | "content-type" | "accept" | "accept-language"
            ) || value.len() > 8192
                || value.contains(['\r', '\n'])
            {
                return Err("[marketplace.header] Header is not allowed".into());
            }
            builder = builder.header(key, value);
        }
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        let mut response = builder
            .send()
            .await
            .map_err(|_| "[marketplace.network] Request failed")?;
        if response.status().is_redirection() {
            return Err("[marketplace.redirect] API redirects are prohibited".into());
        }
        if response
            .content_length()
            .is_some_and(|bytes| bytes > RESPONSE_BYTES as u64)
        {
            return Err("[resource.limit] Marketplace response exceeds 4 MiB".into());
        }
        let status = response.status().as_u16();
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "[marketplace.network] Response stream failed")?
        {
            if bytes.len().saturating_add(chunk.len()) > RESPONSE_BYTES {
                return Err("[resource.limit] Marketplace response exceeds 4 MiB".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if app
            .state::<crate::commands::fs::WorkspaceState>()
            .generation()
            != generation
        {
            return Err("[workspace.generation] Workspace changed during request".into());
        }
        let value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| "[marketplace.schema] Response is not JSON")?;
        validate_json(&value, 0, &mut 0)?;
        if let Some(signed) = value.get("signedCatalog") {
            if !(200..300).contains(&status) {
                return Err(
                    "[catalog.status] Signed catalog requires a successful response".into(),
                );
            }
            let catalog: crate::marketplace_catalog::SignedCatalog =
                serde_json::from_value(signed.clone())
                    .map_err(|_| "[catalog.schema] Invalid signed catalog envelope")?;
            let source = url.origin().ascii_serialization();
            let request = crate::marketplace_catalog::request_key(&url);
            let app = app.clone();
            return tokio::task::spawn_blocking(move || {
                let body =
                    serde_json::to_string(&crate::marketplace_catalog::response(&catalog, false))
                        .map_err(|e| e.to_string())?;
                crate::marketplace_catalog::retain(&app, catalog, &source, &request)?;
                Ok(Response {
                    status,
                    body,
                    catalog_verified: true,
                })
            })
            .await
            .map_err(|e| e.to_string())?;
        }
        let body = String::from_utf8(bytes).map_err(|_| "[marketplace.schema] Invalid UTF-8")?;
        Ok(Response {
            status,
            body,
            catalog_verified: false,
        })
    };
    tokio::select! { _ = abort.notified() => Err("[request.cancelled] Marketplace request cancelled".into()), result = work => result }
}

#[tauri::command]
pub fn marketplace_cancel(state: State<MarketplaceState>, request_id: String) {
    if let Ok(active) = state.active.lock() {
        if let Some(abort) = active.get(&request_id) {
            abort.notify_one();
        }
    }
}

#[tauri::command]
pub async fn marketplace_image(
    app: tauri::AppHandle,
    state: State<'_, MarketplaceState>,
    source: String,
) -> Result<String, String> {
    let url = url(&source)?;
    let generation = authorize(&app, &state, &url).await?;
    let _permit = crate::resource_limits::DOWNLOADS
        .acquire()
        .await
        .map_err(|_| "[download.closed] Queue closed")?;
    let client = crate::network_policy::pinned_client(&url).await?;
    let mut response = client
        .get(url.clone())
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| "[marketplace.image] Image request failed")?;
    if !response.status().is_success() {
        return Err("[marketplace.image] Image request failed or redirected".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "[marketplace.image] Image stream failed")?
    {
        if bytes.len().saturating_add(chunk.len()) > 2 * 1024 * 1024 {
            return Err("[resource.limit] Image exceeds 2 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation()
        != generation
    {
        return Err("[workspace.generation] Workspace changed".into());
    }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| "[marketplace.image] Unsupported image format")?;
        bytes = crate::extensions::content::svg(text)?.into_bytes();
        "image/svg+xml"
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sources_and_response_complexity_fail_closed() {
        for raw in [
            "file:///secret",
            "https://evil.test/icon",
            "http://marketplace.aurona.cc/api",
            "https://user:secret@marketplace.aurona.cc/api",
            "https://169.254.169.254/api",
        ] {
            assert!(url(raw).is_err());
        }
        assert!(url("https://marketplace.aurona.cc/api/extensions?page=2").is_ok());
        assert!(url("http://127.0.0.1:5219/api/extensions").is_ok());
        assert!(validate_json(&serde_json::json!(vec![0; 1001]), 0, &mut 0).is_err());
    }
}
