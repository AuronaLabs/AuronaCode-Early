use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::io::AsyncWriteExt;

use crate::artifact_signature::{self, ArtifactPayload, SignedArtifact};

struct Artifact {
    kind: String,
    generation: Option<u64>,
    file: tempfile::NamedTempFile,
    signed: Option<ArtifactPayload>,
    created: Instant,
    sha256: String,
    size: u64,
}

#[derive(Default)]
pub struct ArtifactState {
    entries: Mutex<HashMap<String, Artifact>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactHandle {
    artifact_id: String,
    sha256: String,
    size_bytes: u64,
    verified: bool,
}

impl ArtifactState {
    pub(crate) fn register_toolchain(
        &self,
        file: tempfile::NamedTempFile,
        signed: ArtifactPayload,
        generation: u64,
    ) -> Result<ArtifactHandle, String> {
        self.insert(Artifact {
            kind: "toolchain".into(),
            generation: Some(generation),
            sha256: signed.sha256.to_ascii_lowercase(),
            size: signed.size_bytes,
            file,
            signed: Some(signed),
            created: Instant::now(),
        })
    }
    fn insert(&self, artifact: Artifact) -> Result<ArtifactHandle, String> {
        let mut entries = self.entries.lock().map_err(|e| e.to_string())?;
        entries.retain(|_, entry| entry.created.elapsed() < Duration::from_secs(600));
        if entries.len() >= 16 {
            return Err("[resource.limit] Artifact registry is full".into());
        }
        let id = format!("artifact-{:032x}", rand::random::<u128>());
        let handle = ArtifactHandle {
            artifact_id: id.clone(),
            sha256: artifact.sha256.clone(),
            size_bytes: artifact.size,
            verified: artifact.signed.is_some(),
        };
        entries.insert(id, artifact);
        Ok(handle)
    }

    fn take(&self, id: &str, kind: &str, generation: u64) -> Result<Artifact, String> {
        let entry = self
            .entries
            .lock()
            .map_err(|e| e.to_string())?
            .remove(id)
            .ok_or("[artifact.handle] Artifact does not exist or was consumed")?;
        if entry.created.elapsed() >= Duration::from_secs(600) {
            return Err("[artifact.expired] Artifact handle expired".into());
        }
        if entry.kind != kind {
            return Err("[artifact.kind] Artifact cannot be consumed by this installer".into());
        }
        if entry.generation != Some(generation) {
            return Err(
                "[workspace.generation] Artifact belongs to an earlier workspace session".into(),
            );
        }
        Ok(entry)
    }
}

#[tauri::command]
pub async fn artifact_download(
    app: tauri::AppHandle,
    tasks: State<'_, crate::tasks::TaskState>,
    state: State<'_, ArtifactState>,
    task_id: String,
    url: String,
    extension_id: String,
    version: Option<String>,
) -> Result<ArtifactHandle, String> {
    let task = tasks.begin(&task_id)?;
    tokio::select! {
        biased;
        _ = task.cancelled() => Err("[task.cancelled] Artifact download cancelled".into()),
        result = download_artifact(&app, &state, url, extension_id, version) => result,
    }
}

async fn download_artifact(
    app: &tauri::AppHandle,
    state: &ArtifactState,
    url: String,
    extension_id: String,
    version: Option<String>,
) -> Result<ArtifactHandle, String> {
    let generation = app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation();
    let origin = crate::network_policy::validate_download_url(
        &url,
        crate::network_policy::DownloadPurpose::Extension,
    )?
    .origin()
    .ascii_serialization();
    if origin != "https://marketplace.aurona.cc" {
        return Err(
            "[artifact.source] Extension artifacts require the official Marketplace source".into(),
        );
    }
    let _permit = crate::resource_limits::DOWNLOADS
        .try_acquire()
        .map_err(|_| "[resource.limit] Download concurrency limit reached")?;
    let mut response = crate::network_policy::download_response(
        &url,
        crate::network_policy::DownloadPurpose::Extension,
    )
    .await?;
    let descriptor = response
        .headers()
        .get("X-Aurona-Artifact-Descriptor")
        .and_then(|value| value.to_str().ok())
        .ok_or("[signature.required] Marketplace artifact signing metadata is unavailable")?;
    if descriptor.len() > 16 * 1024 {
        return Err("[resource.limit] Artifact signature descriptor is too large".into());
    }
    let signed: SignedArtifact = serde_json::from_slice(
        &STANDARD
            .decode(descriptor)
            .map_err(|_| "[signature.schema] Invalid signature descriptor encoding")?,
    )
    .map_err(|_| "[signature.schema] Invalid signature descriptor")?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let expected_version = version.as_deref().unwrap_or(&signed.payload.version);
    artifact_signature::verify(
        &signed,
        &artifact_signature::trusted_keys()?,
        &extension_id,
        expected_version,
        "wasm32-wasip2",
        &origin,
        crate::marketplace_catalog::installation_revision(
            app,
            &origin,
            &extension_id,
            expected_version,
        )?,
        now,
    )?;
    if signed.payload.size_bytes > super::extensions::aurx::MAX_ARCHIVE_BYTES {
        return Err("[resource.limit] AURX artifact exceeds 48 MiB".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length != signed.payload.size_bytes)
    {
        return Err("[signature.size] Download length differs from the signed size".into());
    }
    let file = tempfile::Builder::new()
        .prefix("aurona-artifact-")
        .tempfile()
        .map_err(|e| e.to_string())?;
    let mut output = tokio::fs::File::from_std(file.reopen().map_err(|e| e.to_string())?);
    let mut hash = Sha256::new();
    let mut size = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "[artifact.download] Artifact stream failed")?
    {
        size = size.saturating_add(chunk.len() as u64);
        if size > signed.payload.size_bytes {
            return Err("[signature.size] Artifact grew beyond its signed size".into());
        }
        output.write_all(&chunk).await.map_err(|e| e.to_string())?;
        hash.update(&chunk);
    }
    output.sync_all().await.map_err(|e| e.to_string())?;
    drop(output);
    let sha256 = format!("{:x}", hash.finalize());
    if size != signed.payload.size_bytes || sha256 != signed.payload.sha256.to_ascii_lowercase() {
        return Err("[signature.hash] Download does not match the signed artifact".into());
    }
    if app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation()
        != generation
    {
        return Err("[workspace.generation] Workspace changed during artifact download".into());
    }
    state.insert(Artifact {
        kind: "extension".into(),
        generation: Some(generation),
        file,
        signed: Some(signed.payload),
        created: Instant::now(),
        sha256,
        size,
    })
}

#[tauri::command]
pub async fn artifact_pick(
    app: tauri::AppHandle,
    state: State<'_, ArtifactState>,
    kind: String,
) -> Result<Option<ArtifactHandle>, String> {
    let limit = match kind.as_str() {
        "extension" | "vscode" => super::extensions::aurx::MAX_ARCHIVE_BYTES,
        "toolchain" => crate::resource_limits::DOWNLOAD_BYTES,
        _ => return Err("[artifact.kind] Unknown artifact kind".into()),
    };
    let generation = app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation();
    let _permit = crate::resource_limits::DOWNLOADS
        .try_acquire()
        .map_err(|_| "[resource.limit] Artifact acquisition concurrency limit reached")?;
    let picker_app = app.clone();
    let picker_kind = kind.clone();
    let selected = tokio::task::spawn_blocking(move || {
        picker_app
            .dialog()
            .file()
            .add_filter(
                "Aurona package",
                if picker_kind == "vscode" {
                    &["vsix"][..]
                } else if picker_kind == "extension" {
                    &["aurx"][..]
                } else {
                    &["aurlsp", "zip"][..]
                },
            )
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(tauri_plugin_dialog::FilePath::Path(path)) = selected else {
        return Ok(None);
    };
    let artifact = tokio::task::spawn_blocking(move || {
        let mut source = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut file = tempfile::Builder::new()
            .prefix("aurona-local-artifact-")
            .tempfile()
            .map_err(|e| e.to_string())?;
        let size = std::io::copy(&mut (&mut source).take(limit + 1), &mut file)
            .map_err(|e| e.to_string())?;
        if size > limit {
            return Err("[resource.limit] Selected artifact exceeds its package budget".into());
        }
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut reader = file.reopen().map_err(|e| e.to_string())?;
        let mut chunk = [0u8; 256 * 1024];
        loop {
            let count = reader.read(&mut chunk).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            hash.update(&chunk[..count]);
        }
        Ok::<_, String>(Artifact {
            kind,
            generation: Some(generation),
            file,
            signed: None,
            created: Instant::now(),
            sha256: format!("{:x}", hash.finalize()),
            size,
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    if app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation()
        != generation
    {
        return Err("[workspace.generation] Workspace changed during artifact selection".into());
    }
    Ok(Some(state.insert(artifact)?))
}

pub async fn install_vscode(
    app: tauri::AppHandle,
    artifact_id: &str,
) -> Result<super::extensions::registry::ExtensionDescriptor, String> {
    let generation = app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation();
    let artifact = app
        .state::<ArtifactState>()
        .take(artifact_id, "vscode", generation)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let (title, body) = crate::authorization_dialogs::text(
        &app,
        "artifact",
        &[
            ("kind", "VSIX"),
            ("hash", &artifact.sha256),
            ("bytes", &artifact.size.to_string()),
        ],
    );
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
        return Err("[artifact.cancelled] VSIX installation cancelled".into());
    }
    if app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation()
        != generation
    {
        return Err("[workspace.generation] Workspace changed during VSIX approval".into());
    }
    tokio::task::spawn_blocking(move || {
        let bytes = artifact.read_package()?;
        app.state::<super::extensions::state::ExtensionState>()
            .install_vsix_package(&app, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub async fn install_toolchain(
    app: tauri::AppHandle,
    artifact_id: &str,
    task_id: &str,
) -> Result<crate::toolchains::InstalledToolchainSummary, String> {
    let tasks = app.state::<crate::tasks::TaskState>();
    let task = tasks.begin(task_id)?;
    let cancelled = task.flag();
    let generation = app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation();
    let artifact = app
        .state::<ArtifactState>()
        .take(artifact_id, "toolchain", generation)?;
    if artifact.signed.is_none() {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let (title, body) = crate::authorization_dialogs::text(
            &app,
            "artifact",
            &[
                ("kind", "toolchain"),
                ("hash", &artifact.sha256),
                ("bytes", &artifact.size.to_string()),
            ],
        );
        app.dialog()
            .message(body)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancel)
            .show(move |approved| {
                let _ = sender.send(approved);
            });
        if !matches!(
            tokio::select! { biased; _ = task.cancelled() => return Err("[task.cancelled] Toolchain installation cancelled".into()), approved = tokio::time::timeout(Duration::from_secs(60), receiver) => approved },
            Ok(Ok(true))
        ) {
            return Err("[artifact.cancelled] Toolchain installation cancelled".into());
        }
    }
    if generation
        != app
            .state::<crate::commands::fs::WorkspaceState>()
            .generation()
    {
        return Err("[workspace.generation] Workspace changed during authorization".into());
    }
    let install_app = app.clone();
    use tauri::Emitter;
    let progress = |stage: &str| {
        let _ = app.emit(
            "toolchain://download_progress",
            crate::toolchains::ToolchainProgressPayload {
                download_id: task_id.into(),
                stage: stage.into(),
                downloaded_bytes: artifact.size,
                total_bytes: artifact.size,
                percentage: 100.0,
                message: None,
            },
        );
    };
    progress("extracting");
    let result = tokio::task::spawn_blocking(move || {
        crate::toolchains::install_toolchain_file_cancellable(
            &install_app,
            artifact.file.path(),
            Some(&artifact.sha256),
            Some(&cancelled),
            artifact.signed.as_ref(),
            generation,
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = app.emit("toolchain://download_progress", serde_json::json!({ "downloadId": task_id, "stage": if result.is_ok() { "completed" } else { "failed" }, "downloadedBytes": 0, "totalBytes": 0, "percentage": if result.is_ok() { 100 } else { 0 }, "message": result.as_ref().err() }));
    result
}

pub async fn install_extension(
    app: tauri::AppHandle,
    artifacts: &ArtifactState,
    id: &str,
) -> Result<super::extensions::registry::ExtensionDescriptor, String> {
    let generation = app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation();
    let artifact = artifacts.take(id, "extension", generation)?;
    let bytes = artifact.read_package()?;
    let package = super::extensions::aurx::open_package(&bytes)?;
    if let Some(payload) = &artifact.signed {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        if payload.expires_at <= now {
            return Err(
                "[signature.expired] Artifact signature expired before installation".into(),
            );
        }
        artifact_signature::verify_bytes(payload, &bytes)?;
        if payload.extension_id != package.manifest.id
            || payload.version != package.manifest.version
            || payload.publisher != package.manifest.publisher
        {
            return Err(
                "[signature.manifest] Installed package identity differs from its signature".into(),
            );
        }
    } else {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let (title, body) = crate::authorization_dialogs::text(
            &app,
            "artifact",
            &[
                (
                    "kind",
                    &format!("{} {}", package.manifest.id, package.manifest.version),
                ),
                ("hash", &artifact.sha256),
                ("bytes", &artifact.size.to_string()),
            ],
        );
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
            return Err("[artifact.cancelled] Local extension installation cancelled".into());
        }
    }
    if app
        .state::<crate::commands::fs::WorkspaceState>()
        .generation()
        != generation
    {
        return Err("[workspace.generation] Workspace changed during authorization".into());
    }
    tokio::task::spawn_blocking(move || {
        app.state::<super::extensions::state::ExtensionState>()
            .install_package(&app, &bytes, Some(&artifact.sha256))
    })
    .await
    .map_err(|e| e.to_string())?
}

impl Artifact {
    fn read_package(&self) -> Result<Vec<u8>, String> {
        if self.size > super::extensions::aurx::MAX_ARCHIVE_BYTES {
            return Err("[resource.limit] Extension artifact exceeds 48 MiB".into());
        }
        let mut bytes = Vec::new();
        self.file
            .reopen()
            .map_err(|e| e.to_string())?
            .take(super::extensions::aurx::MAX_ARCHIVE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 != self.size || format!("{:x}", Sha256::digest(&bytes)) != self.sha256
        {
            return Err("[artifact.changed] Artifact changed after acquisition".into());
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn artifact(kind: &str, generation: u64) -> Artifact {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"package").unwrap();
        Artifact {
            kind: kind.into(),
            generation: Some(generation),
            file,
            signed: None,
            created: Instant::now(),
            sha256: format!("{:x}", Sha256::digest(b"package")),
            size: 7,
        }
    }

    #[test]
    fn handles_are_single_use_and_reject_wrong_kind_generation_and_expiry() {
        let state = ArtifactState::default();
        let handle = state.insert(artifact("vscode", 4)).unwrap();
        assert_eq!(
            state
                .take(&handle.artifact_id, "vscode", 4)
                .unwrap()
                .read_package()
                .unwrap(),
            b"package"
        );
        assert!(state.take(&handle.artifact_id, "vscode", 4).is_err());
        for (kind, generation) in [("toolchain", 4), ("vscode", 5)] {
            let handle = state.insert(artifact("vscode", 4)).unwrap();
            assert!(state.take(&handle.artifact_id, kind, generation).is_err());
            assert!(state.entries.lock().unwrap().is_empty());
        }
        let mut expired = artifact("extension", 4);
        expired.created = Instant::now() - Duration::from_secs(601);
        let handle = state.insert(expired).unwrap();
        assert!(state.take(&handle.artifact_id, "extension", 4).is_err());
        assert!(state.entries.lock().unwrap().is_empty());
    }

    #[test]
    fn changed_artifacts_fail_before_install_and_consumed_temp_files_are_removed() {
        let state = ArtifactState::default();
        for replacement in [b"changed".as_slice(), b"longer package".as_slice()] {
            let entry = artifact("extension", 1);
            let path = entry.file.path().to_path_buf();
            std::fs::write(&path, replacement).unwrap();
            let handle = state.insert(entry).unwrap();
            let taken = state.take(&handle.artifact_id, "extension", 1).unwrap();
            assert!(taken.read_package().is_err());
            drop(taken);
            assert!(!path.exists());
        }
        for _ in 0..16 {
            state.insert(artifact("toolchain", 1)).unwrap();
        }
        assert!(state.insert(artifact("toolchain", 1)).is_err());
        assert_eq!(state.entries.lock().unwrap().len(), 16);
    }
}
