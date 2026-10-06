use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<tauri_plugin_updater::Update>>,
    operation: tokio::sync::Mutex<()>,
}

fn channel() -> &'static str {
    if option_env!("AURONA_CHANNEL") == Some("pioneer") {
        "pioneer"
    } else {
        "stable"
    }
}

fn signed_artifact(
    app: &tauri::AppHandle,
    update: &tauri_plugin_updater::Update,
) -> Result<crate::release_verification::ReleaseArtifact, String> {
    let config = serde_json::to_value(app.config()).map_err(|e| e.to_string())?;
    let key = crate::release_verification::updater_key(&config)?;
    let decoded = STANDARD
        .decode(&update.signature)
        .map_err(|_| "[update.signature] Invalid signature encoding")?;
    let signature =
        std::str::from_utf8(&decoded).map_err(|_| "[update.signature] Invalid signature text")?;
    crate::release_verification::runtime_artifact(
        &update.raw_json,
        &key,
        &update.version,
        channel(),
        &update.target,
        &update.download_url,
        signature,
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    body: Option<String>,
}

async fn confirm(
    app: &tauri::AppHandle,
    kind: &str,
    fields: &[(&str, &str)],
) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let (title, body) = crate::authorization_dialogs::text(app, kind, fields);
    app.dialog()
        .message(body)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancel)
        .show(move |approved| {
            let _ = sender.send(approved);
        });
    if !matches!(
        tokio::time::timeout(Duration::from_secs(60), receiver).await,
        Ok(Ok(true))
    ) {
        return Err("[update.cancelled] Operation cancelled".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn app_update_check(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
    proxy: Option<String>,
) -> Result<Option<UpdateInfo>, String> {
    let _operation = state.operation.lock().await;
    state
        .pending
        .lock()
        .map_err(|_| "[update.state] Update state unavailable")?
        .take();
    let mut builder = app.updater_builder().timeout(Duration::from_secs(15));
    if let Some(proxy) = proxy {
        let url = url::Url::parse(&proxy).map_err(|_| "[update.proxy] Invalid proxy")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || proxy.len() > 8192
        {
            return Err("[update.proxy] Unsupported proxy".into());
        }
        builder = builder.proxy(url);
    }
    let Some(mut update) = builder
        .build()
        .map_err(|e| crate::redaction::redact(&e.to_string()))?
        .check()
        .await
        .map_err(|e| crate::redaction::redact(&e.to_string()))?
    else {
        return Ok(None);
    };
    crate::network_policy::validate_download_url(
        update.download_url.as_str(),
        crate::network_policy::DownloadPurpose::Update,
    )?;
    let running = &app.package_info().version;
    let version =
        semver::Version::parse(&update.version).map_err(|_| "[update.version] Invalid version")?;
    if running.pre.is_empty() && !version.pre.is_empty() {
        return Ok(None);
    }
    signed_artifact(&app, &update)?;
    update.timeout = Some(Duration::from_secs(300));
    let info = UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        body: update.body.clone(),
    };
    *state
        .pending
        .lock()
        .map_err(|_| "[update.state] Update state unavailable")? = Some(update);
    Ok(Some(info))
}

#[tauri::command]
pub async fn app_update_clear(state: tauri::State<'_, UpdateState>) -> Result<(), String> {
    let _operation = state.operation.lock().await;
    if let Ok(mut pending) = state.pending.lock() {
        pending.take();
    }
    Ok(())
}

#[tauri::command]
pub async fn app_update_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    let _operation = state.operation.lock().await;
    let update = state
        .pending
        .lock()
        .map_err(|_| "[update.state] Update state unavailable")?
        .take()
        .ok_or("[update.state] Check for an update first")?;
    let artifact = signed_artifact(&app, &update)?;
    confirm(&app, "update", &[("version", &update.version)]).await?;
    let signature_text = STANDARD
        .decode(&update.signature)
        .map_err(|_| "[update.signature] Invalid signature encoding")?;
    let signature = minisign_verify::Signature::decode(
        std::str::from_utf8(&signature_text)
            .map_err(|_| "[update.signature] Invalid signature text")?,
    )
    .map_err(|_| "[update.signature] Invalid Minisign signature")?;
    let config = serde_json::to_value(app.config()).map_err(|e| e.to_string())?;
    let key = crate::release_verification::updater_key(&config)?;
    let mut verifier = key
        .verify_stream(&signature)
        .map_err(|_| "[update.signature] Signing key mismatch")?;
    let _permit = crate::resource_limits::DOWNLOADS
        .acquire()
        .await
        .map_err(|e| e.to_string())?;
    let mut response = crate::network_policy::download_response(
        update.download_url.as_str(),
        crate::network_policy::DownloadPurpose::Update,
    )
    .await?;
    let total = response.content_length();
    if total.is_some_and(|size| size > crate::resource_limits::DOWNLOAD_BYTES) {
        return Err("[resource.limit] Update exceeds 1 GiB".into());
    }
    let _ = app.emit(
        "app-update-progress",
        serde_json::json!({"status":"started","progress":0,"total":total}),
    );
    let mut file = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut downloaded = 0u64;
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    use std::io::{Read, Seek, Write};
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "[update.download] Download interrupted")?
    {
        downloaded = downloaded
            .checked_add(chunk.len() as u64)
            .ok_or("[resource.limit] Update size overflow")?;
        if downloaded > artifact.size_bytes || downloaded > crate::resource_limits::DOWNLOAD_BYTES {
            return Err("[resource.limit] Update exceeds 1 GiB".into());
        }
        verifier.update(&chunk);
        hash.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        let _ = app.emit("app-update-progress", serde_json::json!({"status":"progress","progress":total.filter(|s| *s > 0).map(|s| downloaded as f64/s as f64).unwrap_or(0.0),"current":downloaded,"total":total}));
    }
    verifier
        .finalize()
        .map_err(|_| "[update.signature] Update signature failed")?;
    if downloaded != artifact.size_bytes
        || format!("{:x}", hash.finalize()) != artifact.sha256.to_ascii_lowercase()
    {
        return Err("[release.hash] Update does not match the signed release artifact".into());
    }
    if total.is_some_and(|size| size != downloaded) {
        return Err("[update.size] Download size mismatch".into());
    }
    file.sync_all().map_err(|e| e.to_string())?;
    // Tauri's installer API requires bytes; the download and signature pass are streamed.
    tokio::task::spawn_blocking(move || {
        file.rewind().map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        update
            .install(bytes)
            .map_err(|e| crate::redaction::redact(&e.to_string()))
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit(
        "app-update-progress",
        serde_json::json!({"status":"finished","progress":1}),
    );
    app.restart();
}

#[tauri::command]
pub async fn app_restart(app: tauri::AppHandle) -> Result<(), String> {
    confirm(&app, "restart", &[]).await?;
    app.restart();
}
