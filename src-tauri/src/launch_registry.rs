use crate::commands::fs::WorkspaceState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchSpec {
    pub kind: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub configuration: serde_json::Value,
}

#[derive(Clone)]
struct AuthorizedLaunch {
    spec: LaunchSpec,
    generation: u64,
    fingerprint: String,
}

#[derive(Default)]
pub struct LaunchRegistry(Mutex<HashMap<String, AuthorizedLaunch>>);

fn executable(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() || raw.len() > 4096 || raw.contains('\0') {
        return Err("[launch.command] Invalid executable".into());
    }
    let requested = Path::new(raw);
    if requested.is_absolute() {
        return requested
            .canonicalize()
            .map_err(|_| "[launch.command] Executable is unavailable".into());
    }
    if requested.components().count() != 1 {
        return Err("[launch.command] Executable must be absolute or a PATH name".into());
    }
    for directory in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .filter(|dir| dir.is_absolute())
    {
        let candidates = vec![directory.join(raw)];
        #[cfg(windows)]
        let candidates = {
            let mut candidates = candidates;
            if requested.extension().is_none() {
                candidates.push(directory.join(format!("{raw}.exe")));
            }
            candidates
        };
        for candidate in candidates {
            if candidate.is_file() {
                return candidate
                    .canonicalize()
                    .map_err(|_| "[launch.command] Executable cannot be resolved".into());
            }
        }
    }
    Err("[launch.command] Executable was not found on PATH".into())
}

fn validate_spec(spec: &LaunchSpec) -> Result<(), String> {
    if !matches!(spec.kind.as_str(), "lsp" | "dap" | "python")
        || spec.args.len() > 128
        || spec.env.len() > 64
    {
        return Err("[launch.configuration] Invalid launch kind or configuration limit".into());
    }
    if serde_json::to_vec(spec).map_err(|e| e.to_string())?.len() > 256 * 1024
        || spec
            .args
            .iter()
            .any(|arg| arg.len() > 16384 || arg.contains('\0'))
    {
        return Err("[resource.limit] Launch configuration exceeds limit".into());
    }
    for (key, value) in &spec.env {
        let upper = key.to_ascii_uppercase();
        if key.is_empty()
            || key.contains(['=', '\0'])
            || value.contains('\0')
            || matches!(
                upper.as_str(),
                "PATH"
                    | "PATHEXT"
                    | "NODE_OPTIONS"
                    | "NODE_PATH"
                    | "PYTHONPATH"
                    | "PYTHONHOME"
                    | "LD_PRELOAD"
                    | "LD_LIBRARY_PATH"
                    | "DYLD_INSERT_LIBRARIES"
                    | "DYLD_LIBRARY_PATH"
                    | "HTTP_PROXY"
                    | "HTTPS_PROXY"
                    | "ALL_PROXY"
                    | "NO_PROXY"
            )
        {
            return Err(
                "[launch.environment] Environment injection or proxy override is prohibited".into(),
            );
        }
    }
    Ok(())
}

fn fingerprint(spec: &LaunchSpec) -> Result<String, String> {
    let mut hash = Sha256::new();
    hash.update(serde_jcs::to_vec(spec).map_err(|e| e.to_string())?);
    let mut files = vec![PathBuf::from(&spec.command)];
    for argument in &spec.args {
        let path = Path::new(argument);
        let path = if path.is_absolute() {
            path.to_owned()
        } else {
            Path::new(&spec.cwd).join(path)
        };
        if path.is_file() {
            files.push(path);
        }
    }
    for path in files {
        let mut file = std::fs::File::open(&path)
            .map_err(|_| "[launch.changed] Launch file is unavailable")?;
        if file.metadata().map_err(|e| e.to_string())?.len() > 1024 * 1024 * 1024 {
            return Err("[resource.limit] Launch file exceeds fingerprint limit".into());
        }
        hash.update(path.to_string_lossy().as_bytes());
        let mut buffer = [0u8; 65536];
        let mut total = 0u64;
        loop {
            let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            total += read as u64;
            if total > 1024 * 1024 * 1024 {
                return Err("[resource.limit] Launch file grew beyond limit".into());
            }
            hash.update(&buffer[..read]);
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

impl LaunchRegistry {
    pub fn resolve(
        &self,
        workspace: &WorkspaceState,
        id: &str,
        kind: &str,
    ) -> Result<LaunchSpec, String> {
        let mut entries = self
            .0
            .lock()
            .map_err(|_| "[launch.registry] Registry unavailable")?;
        entries.retain(|_, entry| entry.generation == workspace.generation());
        let entry = entries
            .get(id)
            .ok_or("[launch.unauthorized] Launch is not registered for this workspace")?;
        if entry.spec.kind != kind {
            return Err("[launch.kind] Launch kind mismatch".into());
        }
        workspace.require_directory(&entry.spec.cwd)?;
        if fingerprint(&entry.spec)? != entry.fingerprint {
            entries.remove(id);
            return Err("[launch.changed] Launch files changed; approval is required again".into());
        }
        Ok(entry.spec.clone())
    }
}

pub async fn authorize(app: &tauri::AppHandle, mut spec: LaunchSpec) -> Result<String, String> {
    validate_spec(&spec)?;
    let workspace = app.state::<WorkspaceState>();
    let generation = workspace.generation();
    spec.cwd = workspace
        .require_directory(&spec.cwd)?
        .to_string_lossy()
        .into_owned();
    spec.command = executable(&spec.command)?.to_string_lossy().into_owned();
    let frozen = spec.clone();
    let expected = tokio::task::spawn_blocking(move || fingerprint(&frozen))
        .await
        .map_err(|e| e.to_string())??;
    let registry = app.state::<LaunchRegistry>();
    {
        let mut entries = registry
            .0
            .lock()
            .map_err(|_| "[launch.registry] Registry unavailable")?;
        entries.retain(|_, entry| entry.generation == generation);
        if let Some((id, _)) = entries
            .iter()
            .find(|(_, entry)| entry.spec == spec && entry.fingerprint == expected)
        {
            return Ok(id.clone());
        }
        if entries.len() >= 64 {
            return Err("[resource.limit] Launch registry limit reached".into());
        }
    }
    let preview = serde_json::to_string_pretty(&spec).map_err(|e| e.to_string())?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let (title, body) = crate::authorization_dialogs::text(
        app,
        "launch",
        &[("preview", &preview), ("fingerprint", &expected)],
    );
    app.dialog()
        .message(body)
        .title(title)
        .buttons(MessageDialogButtons::YesNo)
        .show(move |approved| {
            let _ = sender.send(approved);
        });
    if !tokio::time::timeout(std::time::Duration::from_secs(60), receiver)
        .await
        .map_err(|_| "[launch.expired] Approval expired")?
        .unwrap_or(false)
    {
        return Err("[launch.denied] Local process was not authorized".into());
    }
    if generation != workspace.generation() {
        return Err("[workspace.generation] Workspace changed during approval".into());
    }
    let frozen = spec.clone();
    if tokio::task::spawn_blocking(move || fingerprint(&frozen))
        .await
        .map_err(|e| e.to_string())??
        != expected
    {
        return Err("[launch.changed] Launch file changed during approval".into());
    }
    let id = format!("launch-{:032x}", rand::random::<u128>());
    let mut entries = registry
        .0
        .lock()
        .map_err(|_| "[launch.registry] Registry unavailable")?;
    if entries.len() >= 64 {
        return Err("[resource.limit] Launch registry limit reached".into());
    }
    entries.insert(
        id.clone(),
        AuthorizedLaunch {
            spec,
            generation,
            fingerprint: expected,
        },
    );
    Ok(id)
}

#[tauri::command]
pub async fn launch_register(app: tauri::AppHandle, spec: LaunchSpec) -> Result<String, String> {
    authorize(&app, spec).await
}

#[tauri::command]
pub fn launch_revoke(state: State<LaunchRegistry>, launch_id: String) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "[launch.registry] Registry unavailable")?
        .remove(&launch_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn spec() -> LaunchSpec {
        LaunchSpec {
            kind: "lsp".into(),
            command: "node".into(),
            args: vec![],
            cwd: ".".into(),
            env: HashMap::new(),
            configuration: serde_json::Value::Null,
        }
    }
    #[test]
    fn launch_environment_and_size_are_checked() {
        for key in [
            "NODE_OPTIONS",
            "pythonpath",
            "LD_PRELOAD",
            "PATH",
            "https_proxy",
        ] {
            let mut value = spec();
            value.env.insert(key.into(), "injected".into());
            assert!(validate_spec(&value).is_err());
        }
        let mut value = spec();
        value.args = vec!["x".repeat(16385)];
        assert!(validate_spec(&value).is_err());
    }
    #[test]
    fn file_change_revokes_fingerprint_even_when_length_is_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("tool.exe");
        std::fs::write(&file, "before").unwrap();
        let mut value = spec();
        value.command = file.to_string_lossy().into_owned();
        let before = fingerprint(&value).unwrap();
        std::fs::write(file, "after!").unwrap();
        assert_ne!(before, fingerprint(&value).unwrap());
    }
}
