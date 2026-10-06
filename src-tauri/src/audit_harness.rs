//! Compiled only into the isolated desktop acceptance binary, never the candidate.
use std::path::PathBuf;
use tauri::Manager;

const IDENTIFIER: &str = "com.aurona.code.audit0414";

pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if app.config().identifier != IDENTIFIER {
        return Err("[audit.isolation] Audit binary requires its isolated identifier".into());
    }
    let path = PathBuf::from(
        std::env::var_os("AURONA_AUDIT_ROOT").ok_or("[audit.isolation] Missing audit workspace")?,
    );
    let canonical = path
        .canonicalize()
        .map_err(|_| "[audit.isolation] Missing audit workspace")?;
    let marker = std::fs::read(canonical.join(".aurona-audit-workspace"))
        .map_err(|_| "[audit.isolation] Missing audit workspace marker")?;
    if marker != b"isolated-0.4.14-acceptance" {
        return Err("[audit.isolation] Invalid audit workspace marker".into());
    }
    Ok(canonical)
}

pub fn verify_isolation(app: &tauri::AppHandle) -> Result<(), String> {
    let workspace = root(app)?;
    let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    if data.file_name().and_then(|name| name.to_str()) != Some(IDENTIFIER) {
        return Err("[audit.isolation] Tauri resolved a non-audit data directory".into());
    }
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let report = serde_json::json!({"identifier":IDENTIFIER,"data":data,"logs":logs,"workspace":workspace,
        "isolatedCredentials":true,"candidateAcceptance":false});
    std::fs::write(
        data.join("audit-isolation.json"),
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
