use cap_fs_ext::DirExt;
use cap_std::fs::Dir;
use std::io::{Read, Write};
use std::path::{Component, Path};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Default)]
pub struct AppStorageState(Mutex<()>);

fn validate(area: &str, path: &str, directory: bool) -> Result<(), String> {
    if path.len() > 240
        || path.contains(['\\', ':', '\0'])
        || path.split('/').any(|s| s == "." || s == "..")
        || Path::new(path)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("[storage.path] Invalid storage key".into());
    }
    let allowed = match (area, directory) {
        ("data", true) => matches!(path, "" | "editor-recovery"),
        ("log", true) => matches!(path, "" | "errlogs"),
        ("data", false) => {
            matches!(path, "user-config.json" | "workspace.json")
                || path.strip_prefix("editor-recovery/").is_some_and(|name| {
                    name.ends_with(".json") && !name.contains('/') && name.len() <= 128
                })
        }
        ("log", false) => {
            path == "app.log"
                || path.strip_prefix("errlogs/").is_some_and(|name| {
                    name.starts_with("Aurona-Error-")
                        && name.ends_with(".log")
                        && !name.contains('/')
                })
        }
        _ => false,
    };
    if !allowed {
        return Err("[storage.scope] Storage key is not authorized".into());
    }
    Ok(())
}

fn directory(app: &tauri::AppHandle, area: &str, path: &str) -> Result<(Dir, String), String> {
    let root = match area {
        "data" => app.path().app_local_data_dir(),
        "log" => app.path().app_log_dir(),
        _ => return Err("[storage.scope] Unknown storage area".into()),
    }
    .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let mut dir =
        Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(|e| e.to_string())?;
    let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
    if !parent.is_empty() {
        dir.create_dir(parent)
            .or_else(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    Ok(())
                } else {
                    Err(e)
                }
            })
            .map_err(|e| e.to_string())?;
        dir = dir
            .open_dir_nofollow(parent)
            .map_err(|_| "[storage.link] Storage directory is a link")?;
    }
    Ok((dir, name.into()))
}

#[tauri::command]
pub fn app_storage_exists(
    app: tauri::AppHandle,
    area: String,
    path: String,
) -> Result<bool, String> {
    validate(&area, &path, false)?;
    let (dir, name) = directory(&app, &area, &path)?;
    match crate::scoped_file::open(&dir, Path::new(&name)) {
        Ok(file) => Ok(file.metadata().map_err(|e| e.to_string())?.is_file()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("[storage.link] Storage file is unavailable or is a link".into()),
    }
}

#[tauri::command]
pub fn app_storage_read(
    app: tauri::AppHandle,
    area: String,
    path: String,
) -> Result<String, String> {
    validate(&area, &path, false)?;
    let (dir, name) = directory(&app, &area, &path)?;
    let mut bytes = Vec::new();
    crate::scoped_file::open(&dir, Path::new(&name))
        .map_err(|e| e.to_string())?
        .take(crate::resource_limits::TEXT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > crate::resource_limits::TEXT_BYTES {
        return Err("[resource.limit] Stored text exceeds 32 MiB".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "[storage.encoding] Invalid UTF-8")?;
    // Old credentials are read only by the keyring migration command.
    if path == "user-config.json" {
        let config: serde_json::Value =
            serde_json::from_str(&text).map_err(|_| "[storage.schema] Invalid configuration")?;
        reject_credentials(&config)?;
    }
    Ok(text)
}

fn reject_credentials(value: &serde_json::Value) -> Result<(), String> {
    match value {
        serde_json::Value::Object(fields) => {
            for (key, value) in fields {
                if key == "apiKey" && value.as_str().is_some_and(|s| !s.is_empty()) {
                    return Err(
                        "[storage.credential] Credentials require the keyring migration service"
                            .into(),
                    );
                }
                reject_credentials(value)?;
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                reject_credentials(item)?;
            }
        }
        _ => (),
    }
    Ok(())
}

#[tauri::command]
pub fn app_storage_write(
    app: tauri::AppHandle,
    state: tauri::State<AppStorageState>,
    area: String,
    path: String,
    content: String,
    append: bool,
) -> Result<(), String> {
    validate(&area, &path, false)?;
    if content.len() > crate::resource_limits::TEXT_BYTES {
        return Err("[resource.limit] Stored text exceeds 32 MiB".into());
    }
    if path == "user-config.json" {
        reject_credentials(
            &serde_json::from_str(&content)
                .map_err(|_| "[storage.schema] Invalid configuration")?,
        )?;
    }
    if append && area != "log" {
        return Err("[storage.operation] Append is limited to logs".into());
    }
    let _guard = state
        .0
        .lock()
        .map_err(|_| "[storage.state] Storage unavailable")?;
    let (dir, name) = directory(&app, &area, &path)?;
    if append {
        use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
        let mut options = cap_std::fs::OpenOptions::new();
        options.append(true).create(true).follow(FollowSymlinks::No);
        let mut file = dir.open_with(&name, &options).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() + content.len() as u64
            > 16 * 1024 * 1024
        {
            return Err("[resource.limit] Log file exceeds 16 MiB".into());
        }
        file.write_all(crate::redaction::redact(&content).as_bytes())
            .map_err(|e| e.to_string())
    } else {
        let text = if area == "log" {
            crate::redaction::redact(&content)
        } else {
            content
        };
        crate::scoped_file::write(&dir, Path::new(&name), text.as_bytes())
    }
}

#[tauri::command]
pub fn app_storage_mkdir(app: tauri::AppHandle, area: String, path: String) -> Result<(), String> {
    validate(&area, &path, true)?;
    let (dir, _) = directory(&app, &area, "")?;
    if path.is_empty() {
        return Ok(());
    }
    dir.create_dir(&path)
        .or_else(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                Ok(())
            } else {
                Err(e)
            }
        })
        .map_err(|e| e.to_string())?;
    dir.open_dir_nofollow(&path)
        .map_err(|_| "[storage.link] Storage directory is a link")?;
    Ok(())
}

#[tauri::command]
pub fn app_storage_remove(app: tauri::AppHandle, area: String, path: String) -> Result<(), String> {
    validate(&area, &path, false)?;
    let (dir, name) = directory(&app, &area, &path)?;
    dir.remove_file(name).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn storage_keys_cannot_escape_or_access_other_app_data() {
        for path in [
            "../secret",
            "editor-recovery/../../secret",
            "C:/secret",
            "editor-recovery\\secret",
            "extensions/keys.json",
            "",
            "editor-recovery/.",
        ] {
            assert!(validate("data", path, false).is_err(), "{path}");
        }
        assert!(validate("data", "user-config.json", false).is_ok());
        assert!(validate("data", "editor-recovery/123.json", false).is_ok());
        assert!(validate("log", "errlogs/Aurona-Error-test.log", false).is_ok());
        assert!(validate("data", "", true).is_ok());
    }
    #[test]
    fn plaintext_credentials_are_rejected_at_backend_boundary() {
        assert!(
            reject_credentials(&serde_json::json!({"ai":{"profiles":[{"apiKey":"secret"}]}}))
                .is_err()
        );
        assert!(reject_credentials(
            &serde_json::json!({"ai":{"profiles":[{"apiKey":"","credentialId":"stored"}]}})
        )
        .is_ok());
    }
}
