use crate::{
    commands::fs::WorkspaceState,
    launch_registry::{LaunchRegistry, LaunchSpec},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

const INSPECT: &str = "import sys,json,importlib.util; from pip._vendor.packaging.tags import sys_tags; s=importlib.util.find_spec('debugpy'); print(json.dumps({'prefix':sys.prefix,'tags':[str(t) for t in sys_tags()],'installed':s is not None}))";
const STATUS: &str = "import debugpy; print(debugpy.__version__)";

#[derive(Clone, Deserialize, Serialize)]
struct Wheel {
    file: String,
    sha256: String,
    url: String,
    size: u64,
}

#[derive(Deserialize)]
struct Environment {
    prefix: String,
    tags: Vec<String>,
    installed: bool,
}

fn wheels() -> Result<Vec<Wheel>, String> {
    serde_json::from_str(include_str!("../resources/debugpy-1.8.17.json"))
        .map_err(|e| e.to_string())
}

fn choose(tags: &[String]) -> Result<Wheel, String> {
    let pinned = wheels()?;
    for tag in tags {
        if let Some(wheel) = pinned.iter().find(|wheel| {
            wheel
                .file
                .strip_prefix("debugpy-1.8.17-")
                .and_then(|value| value.strip_suffix(".whl"))
                .is_some_and(|value| value == tag)
        }) {
            return Ok(wheel.clone());
        }
    }
    // The upstream universal wheel supplies the pure Python fallback on all platforms.
    if tags.iter().any(|tag| tag == "py3-none-any") {
        return pinned
            .into_iter()
            .find(|wheel| wheel.file == "debugpy-1.8.17-py2.py3-none-any.whl")
            .ok_or("[python.wheel] Universal wheel is unavailable".into());
    }
    Err("[python.wheel] No pinned debugpy wheel matches this interpreter".into())
}

async fn capture(
    app: &AppHandle,
    launch_id: &str,
    args: Vec<String>,
    seconds: u64,
) -> Result<std::process::Output, String> {
    let spec = app.state::<LaunchRegistry>().resolve(
        &app.state::<WorkspaceState>(),
        launch_id,
        "python",
    )?;
    if spec.args != args {
        return Err("[python.configuration] Frozen Python arguments differ".into());
    }
    let tool_use =
        crate::toolchains::acquire_launch_use(app, &spec.command, &spec.args, &spec.cwd)?;
    app.state::<LaunchRegistry>()
        .resolve(&app.state::<WorkspaceState>(), launch_id, "python")?;
    tokio::task::spawn_blocking(move || {
        let _tool_use = tool_use;
        crate::process_service::capture_with_timeout(
            &spec.command,
            &spec.args.iter().map(String::as_str).collect::<Vec<_>>(),
            Some(std::path::Path::new(&spec.cwd)),
            std::time::Duration::from_secs(seconds),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dap_python_prepare(app: AppHandle, python_path: String) -> Result<String, String> {
    let cwd = app
        .state::<WorkspaceState>()
        .root()?
        .ok_or("[workspace.closed] Python requires an active workspace")?
        .to_string_lossy()
        .into_owned();
    crate::launch_registry::authorize(&app, LaunchSpec { kind: "python".into(), command: python_path,
        args: vec!["-I".into(), "-c".into(), INSPECT.into()], cwd, env: HashMap::new(),
        configuration: serde_json::json!({"operation":"inspect-python-environment","debugpyVersion":"1.8.17"}) }).await
}

pub async fn status(app: &AppHandle, launch_id: &str) -> Result<(bool, Option<String>), String> {
    let output = capture(
        app,
        launch_id,
        vec!["-I".into(), "-c".into(), INSPECT.into()],
        8,
    )
    .await?;
    if !output.status.success() {
        return Err("[python.environment] Interpreter inspection failed; pip is required".into());
    }
    let env: Environment = serde_json::from_slice(&output.stdout)
        .map_err(|_| "[python.environment] Invalid interpreter response")?;
    if !env.installed {
        return Ok((false, None));
    }
    let spec = app.state::<LaunchRegistry>().resolve(
        &app.state::<WorkspaceState>(),
        launch_id,
        "python",
    )?;
    let id = crate::launch_registry::authorize(
        app,
        LaunchSpec {
            args: vec!["-I".into(), "-c".into(), STATUS.into()],
            configuration: serde_json::json!({"operation":"debugpy-version","prefix":env.prefix}),
            ..spec
        },
    )
    .await?;
    let output = capture(app, &id, vec!["-I".into(), "-c".into(), STATUS.into()], 8).await?;
    if !output.status.success() {
        return Err("[python.debugpy] Debugpy inspection failed".into());
    }
    Ok((
        true,
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
    ))
}

pub async fn install(app: &AppHandle, launch_id: &str) -> Result<(), String> {
    let generation = app.state::<WorkspaceState>().generation();
    let output = capture(
        app,
        launch_id,
        vec!["-I".into(), "-c".into(), INSPECT.into()],
        8,
    )
    .await?;
    if !output.status.success() {
        return Err("[python.environment] Interpreter inspection failed".into());
    }
    let env: Environment = serde_json::from_slice(&output.stdout)
        .map_err(|_| "[python.environment] Invalid interpreter response")?;
    if env.prefix.is_empty() || env.prefix.len() > 4096 || env.tags.len() > 4096 {
        return Err("[resource.limit] Invalid Python environment".into());
    }
    let wheel = choose(&env.tags)?;
    let directory = tempfile::Builder::new()
        .prefix("aurona-debugpy-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let wheel_path = directory.path().join(&wheel.file);
    let _permit = crate::resource_limits::DOWNLOADS
        .acquire()
        .await
        .map_err(|_| "[download.closed] Download queue is closed")?;
    let mut response = crate::network_policy::download_response(
        &wheel.url,
        crate::network_policy::DownloadPurpose::Debugpy,
    )
    .await?;
    if response
        .content_length()
        .is_some_and(|size| size != wheel.size)
    {
        return Err("[python.wheel] Wheel size differs from pinned metadata".into());
    }
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&wheel_path)
        .await
        .map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "[python.download] Wheel download failed")?
    {
        size += chunk.len() as u64;
        if size > wheel.size {
            return Err("[python.wheel] Wheel exceeded pinned size".into());
        }
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        hash.update(&chunk);
    }
    file.sync_all().await.map_err(|e| e.to_string())?;
    drop(file);
    if size != wheel.size || format!("{:x}", hash.finalize()) != wheel.sha256 {
        return Err("[python.wheel] Wheel hash mismatch".into());
    }
    if app.state::<WorkspaceState>().generation() != generation {
        return Err("[workspace.generation] Workspace changed".into());
    }
    let spec = app.state::<LaunchRegistry>().resolve(
        &app.state::<WorkspaceState>(),
        launch_id,
        "python",
    )?;
    let args = vec![
        "-I".into(),
        "-m".into(),
        "pip".into(),
        "--isolated".into(),
        "install".into(),
        "--no-index".into(),
        "--no-deps".into(),
        "--only-binary=:all:".into(),
        "--disable-pip-version-check".into(),
        wheel_path.to_string_lossy().into_owned(),
    ];
    let id = crate::launch_registry::authorize(app, LaunchSpec { args: args.clone(), configuration: serde_json::json!({"operation":"install-debugpy","prefix":env.prefix,"version":"1.8.17","wheelHash":wheel.sha256,"network":"disabled"}), ..spec }).await?;
    let output = capture(app, &id, args, 120).await?;
    if !output.status.success() {
        return Err(format!(
            "[python.install] {}",
            crate::redaction::redact(&String::from_utf8_lossy(&output.stderr))
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wheel_tags_are_pinned_and_unsupported_interpreters_rejected() {
        for tag in [
            "cp311-cp311-win_amd64",
            "cp312-cp312-macosx_15_0_universal2",
            "cp313-cp313-manylinux_2_34_x86_64",
            "py3-none-any",
        ] {
            let wheel = choose(&[tag.into()]).unwrap();
            assert_eq!(wheel.sha256.len(), 64);
            assert!(wheel
                .url
                .starts_with("https://files.pythonhosted.org/packages/"));
        }
        assert!(choose(&["invalid-tag".into()]).is_err());
    }
}
