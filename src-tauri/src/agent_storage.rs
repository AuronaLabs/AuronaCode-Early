use base64::{engine::general_purpose::STANDARD, Engine};
use cap_fs_ext::DirExt;
use cap_std::fs::Dir;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305};
use ring::rand::{SecureRandom, SystemRandom};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

const MAGIC: &[u8] = b"AURONA-AGENT-1\0";
const CHECKPOINT_BYTES: usize = 256 * 1024 * 1024;
const HISTORY_BYTES: usize = 64 * 1024 * 1024;
#[cfg(not(feature = "audit-harness"))]
const KEYRING_SERVICE: &str = "com.aurona.code.agent";
#[cfg(feature = "audit-harness")]
const KEYRING_SERVICE: &str = "com.aurona.code.audit0414.agent";

#[derive(Default)]
pub struct AgentStorageState(Mutex<()>);

fn quota(slot: &str) -> Result<usize, String> {
    match slot {
        "sessions" | "legacy-chat" => Ok(HISTORY_BYTES),
        "checkpoints" | "journal" => Ok(CHECKPOINT_BYTES),
        _ => Err("[agent.storage_slot] Unknown Agent storage slot".into()),
    }
}

fn directory(app: &tauri::AppHandle) -> Result<Dir, String> {
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let root =
        Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(|e| e.to_string())?;
    root.create_dir("agent-secure")
        .or_else(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                Ok(())
            } else {
                Err(e)
            }
        })
        .map_err(|e| e.to_string())?;
    root.open_dir_nofollow("agent-secure")
        .map_err(|_| "[agent.storage_link] Agent storage cannot be a link".into())
}

fn key(dir: &Dir) -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, "storage-key-v1")
        .map_err(|_| "[agent.keyring] Credential store unavailable")?;
    let stored = match entry.get_password() {
        Ok(key) => key,
        Err(keyring::Error::NoEntry) => {
            if dir.entries().map_err(|e| e.to_string())?.next().is_some() {
                return Err(
                    "[agent.keyring] Encryption key is missing; existing data is preserved".into(),
                );
            }
            let mut generated = [0u8; 32];
            SystemRandom::new()
                .fill(&mut generated)
                .map_err(|_| "[agent.random] Encryption key generation failed")?;
            let encoded = STANDARD.encode(generated);
            entry
                .set_password(&encoded)
                .map_err(|_| "[agent.keyring] Encryption key could not be stored")?;
            let verified = entry
                .get_password()
                .map_err(|_| "[agent.keyring] Encryption key could not be verified")?;
            if verified != encoded {
                return Err("[agent.keyring] Encryption key verification failed".into());
            }
            verified
        }
        Err(_) => {
            return Err(
                "[agent.keyring] Credential store unavailable; Agent writes are paused".into(),
            )
        }
    };
    STANDARD
        .decode(stored)
        .map_err(|_| "[agent.keyring] Invalid encryption key")?
        .try_into()
        .map_err(|_| "[agent.keyring] Invalid encryption key length".into())
}

fn encrypt(key: &[u8; 32], slot: &str, text: &str) -> Result<Vec<u8>, String> {
    let key = LessSafeKey::new(
        UnboundKey::new(&CHACHA20_POLY1305, key).map_err(|_| "[agent.crypto] Invalid key")?,
    );
    let mut nonce = [0u8; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "[agent.random] Nonce generation failed")?;
    let mut encrypted = text.as_bytes().to_vec();
    key.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce),
        Aad::from(slot),
        &mut encrypted,
    )
    .map_err(|_| "[agent.crypto] Encryption failed")?;
    let mut envelope = MAGIC.to_vec();
    envelope.extend(nonce);
    envelope.extend(encrypted);
    Ok(envelope)
}

fn decrypt(key: &[u8; 32], slot: &str, envelope: Vec<u8>) -> Result<String, String> {
    if !envelope.starts_with(MAGIC) || envelope.len() < MAGIC.len() + 12 + 16 {
        return Err("[agent.corrupt] Invalid encrypted envelope; original data preserved".into());
    }
    let nonce: [u8; 12] = envelope[MAGIC.len()..MAGIC.len() + 12]
        .try_into()
        .map_err(|_| "[agent.corrupt] Invalid nonce")?;
    let mut body = envelope[MAGIC.len() + 12..].to_vec();
    let key = LessSafeKey::new(
        UnboundKey::new(&CHACHA20_POLY1305, key).map_err(|_| "[agent.crypto] Invalid key")?,
    );
    let plaintext = key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(slot),
            &mut body,
        )
        .map_err(|_| "[agent.corrupt] Authentication failed; original data preserved")?;
    String::from_utf8(plaintext.to_vec())
        .map_err(|_| "[agent.corrupt] Invalid encrypted text".into())
}

fn read(dir: &Dir, key: &[u8; 32], slot: &str) -> Result<Option<String>, String> {
    let limit = quota(slot)?;
    let file = match crate::scoped_file::open(dir, Path::new(&format!("{slot}.bin"))) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("[agent.storage_link] Agent data unavailable or is a link".into()),
    };
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit + MAGIC.len() + 12 + 16 {
        return Err("[agent.quota] Encrypted storage exceeds quota".into());
    }
    decrypt(key, slot, bytes).map(Some)
}

fn validate(slot: &str, text: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|_| "[agent.schema] Invalid Agent data")?;
    let bounded_text =
        |value: &serde_json::Value, field: &str, limit: usize| -> Result<(), String> {
            let text = value
                .get(field)
                .and_then(serde_json::Value::as_str)
                .ok_or("[agent.schema] Missing text field")?;
            if text.len() > limit || (field == "path" && (text.is_empty() || text.contains('\0'))) {
                return Err("[agent.schema] Invalid text field length".into());
            }
            Ok(())
        };
    let recovery_files = |files: &serde_json::Value| -> Result<Vec<String>, String> {
        let files = files
            .as_array()
            .ok_or("[agent.schema] Recovery files must be an array")?;
        if files.len() > 10000 {
            return Err("[agent.schema] Too many recovery files".into());
        }
        let mut paths = std::collections::HashSet::new();
        let mut ordered = Vec::new();
        for file in files {
            bounded_text(file, "path", 32768)?;
            bounded_text(file, "content", crate::resource_limits::TEXT_BYTES)?;
            let path = file["path"].as_str().unwrap().to_string();
            if !paths.insert(path.clone()) {
                return Err("[agent.schema] Duplicate recovery path".into());
            }
            ordered.push(path);
        }
        Ok(ordered)
    };
    if slot == "sessions" {
        let tasks = value
            .get("tasks")
            .and_then(serde_json::Value::as_array)
            .ok_or("[agent.schema] Missing Agent tasks")?;
        if tasks.len() > 100 {
            return Err("[agent.schema] Too many Agent tasks".into());
        }
        let mut ids = std::collections::HashSet::new();
        for task in tasks {
            bounded_text(task, "id", 512)?;
            if !ids.insert(task["id"].as_str().unwrap()) {
                return Err("[agent.schema] Duplicate task ID".into());
            }
            if task
                .get("schemaVersion")
                .is_some_and(|schema| !matches!(schema.as_u64(), Some(1 | 2)))
            {
                return Err("[agent.schema] Unsupported task schema".into());
            }
            let events = task
                .get("events")
                .and_then(serde_json::Value::as_array)
                .ok_or("[agent.schema] Missing Agent events")?;
            if events.len() > 500 || events.iter().any(|event| !event.is_object()) {
                return Err("[agent.schema] Invalid Agent event list".into());
            }
        }
        if let Some(sessions) = value.get("sessions") {
            let sessions = sessions
                .as_array()
                .ok_or("[agent.schema] Invalid Agent sessions")?;
            if sessions.len() > 20 {
                return Err("[agent.schema] Too many Agent sessions".into());
            }
            for session in sessions {
                bounded_text(session, "id", 512)?;
            }
        }
    }
    if slot == "journal" && !value.is_null() {
        if value.get("schema").and_then(serde_json::Value::as_u64) != Some(1) {
            return Err("[agent.schema] Unsupported recovery journal".into());
        }
        bounded_text(&value, "checkpointId", 512)?;
        bounded_text(&value, "workspaceId", 32768)?;
        let originals = recovery_files(&value["originals"])?;
        let targets = recovery_files(&value["targets"])?;
        if originals != targets {
            return Err("[agent.schema] Recovery target paths differ".into());
        }
    }
    if slot == "legacy-chat" {
        let records = value
            .get("records")
            .and_then(serde_json::Value::as_array)
            .ok_or("[agent.schema] Invalid legacy archive records")?;
        if value.get("schema").and_then(serde_json::Value::as_u64) != Some(1)
            || records.len() > 16
            || records.iter().any(|record| {
                !matches!(
                    record.get("key").and_then(serde_json::Value::as_str),
                    Some("aurona.ai.chat.sessions.v2" | "aurona.ai.chat.history.v1")
                ) || record
                    .get("content")
                    .and_then(serde_json::Value::as_str)
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
                    .is_none_or(|content| !content.is_object() && !content.is_array())
            })
        {
            return Err("[agent.schema] Invalid legacy chat archive".into());
        }
    }
    if slot == "checkpoints" {
        let checkpoints = value
            .as_array()
            .ok_or("[agent.schema] Checkpoints must be an array")?;
        for checkpoint in checkpoints {
            bounded_text(checkpoint, "id", 512)?;
            bounded_text(checkpoint, "taskId", 512)?;
            recovery_files(&checkpoint["files"])?;
            for file in checkpoint
                .get("files")
                .and_then(|v| v.as_array())
                .ok_or("[agent.schema] Invalid checkpoint files")?
            {
                if file
                    .get("content")
                    .and_then(|v| v.as_str())
                    .ok_or("[agent.schema] Missing checkpoint text")?
                    .len()
                    > crate::resource_limits::TEXT_BYTES
                {
                    return Err("[agent.quota] Checkpoint file exceeds 32 MiB".into());
                }
            }
        }
    }
    Ok(())
}

fn write(dir: &Dir, key: &[u8; 32], slot: &str, text: &str) -> Result<(), String> {
    let limit = quota(slot)?;
    if text.len() > limit {
        return Err("[agent.quota] Agent storage byte quota exceeded".into());
    }
    validate(slot, text)?;
    if matches!(slot, "checkpoints" | "journal") {
        let other = if slot == "checkpoints" {
            "journal"
        } else {
            "checkpoints"
        };
        let retained = read(dir, key, other)?.map(|s| s.len()).unwrap_or(0);
        if text.len().saturating_add(retained) > CHECKPOINT_BYTES {
            return Err("[agent.quota] Checkpoints and recovery journal exceed 256 MiB".into());
        }
    }
    if matches!(slot, "sessions" | "legacy-chat") {
        let other = if slot == "sessions" {
            "legacy-chat"
        } else {
            "sessions"
        };
        let retained = read(dir, key, other)?.map(|s| s.len()).unwrap_or(0);
        if text.len().saturating_add(retained) > HISTORY_BYTES {
            return Err("[agent.quota] Agent sessions and legacy archive exceed 64 MiB".into());
        }
    }
    // Never replace a corrupt previous record with an apparently successful fresh store.
    read(dir, key, slot)?;
    let envelope = encrypt(key, slot, text)?;
    let mut stage = crate::scoped_file::StagedFile::new(dir)?;
    stage.file.write_all(&envelope).map_err(|e| e.to_string())?;
    let mut verification = stage.file.try_clone().map_err(|e| e.to_string())?;
    use std::io::{Seek, SeekFrom};
    verification
        .seek(SeekFrom::Start(0))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    verification
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if decrypt(key, slot, bytes)? != text {
        return Err("[agent.storage_verify] Encrypted staging verification failed".into());
    }
    stage.commit(Path::new(&format!("{slot}.bin")))
}

#[tauri::command]
pub async fn agent_storage_read(
    app: tauri::AppHandle,
    slot: String,
) -> Result<Option<String>, String> {
    quota(&slot)?;
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AgentStorageState>();
        let _guard = state
            .0
            .lock()
            .map_err(|_| "[agent.storage_state] Storage unavailable")?;
        let dir = directory(&app)?;
        let key = key(&dir)?;
        read(&dir, &key, &slot)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_storage_write(
    app: tauri::AppHandle,
    slot: String,
    content: String,
) -> Result<(), String> {
    quota(&slot)?;
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AgentStorageState>();
        let _guard = state
            .0
            .lock()
            .map_err(|_| "[agent.storage_state] Storage unavailable")?;
        let dir = directory(&app)?;
        let key = key(&dir)?;
        write(&dir, &key, &slot, &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ciphertext_authenticates_content_key_and_slot() {
        let key = [42u8; 32];
        let data = encrypt(&key, "sessions", "secret history").unwrap();
        assert!(!data.windows(6).any(|w| w == b"secret"));
        assert_eq!(
            decrypt(&key, "sessions", data.clone()).unwrap(),
            "secret history"
        );
        assert!(decrypt(&key, "checkpoints", data.clone()).is_err());
        assert!(decrypt(&[43u8; 32], "sessions", data.clone()).is_err());
        let mut altered = data;
        *altered.last_mut().unwrap() ^= 1;
        assert!(decrypt(&key, "sessions", altered).is_err());
    }
    #[test]
    fn atomic_store_rejects_corruption_and_preserves_previous_record() {
        let root = tempfile::tempdir().unwrap();
        let dir = Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        let key = [42u8; 32];
        write(&dir, &key, "sessions", "{\"tasks\":[]}").unwrap();
        assert_eq!(
            read(&dir, &key, "sessions").unwrap().unwrap(),
            "{\"tasks\":[]}"
        );
        dir.write("sessions.bin", b"corrupt").unwrap();
        assert!(write(&dir, &key, "sessions", "{}").is_err());
        assert_eq!(dir.read("sessions.bin").unwrap(), b"corrupt");
        assert!(quota("../sessions").is_err());
    }

    #[test]
    fn backend_rejects_malformed_recovery_and_future_task_schemas() {
        for (slot, text) in [
            ("journal", "{}"),
            ("checkpoints", "[{\"files\":[]}]"),
            (
                "sessions",
                "{\"tasks\":[{\"id\":\"a\",\"schemaVersion\":3,\"events\":[]}]}",
            ),
            (
                "sessions",
                "{\"tasks\":[{\"id\":\"a\",\"events\":[]},{\"id\":\"a\",\"events\":[]}]}",
            ),
        ] {
            assert!(validate(slot, text).is_err());
        }
        assert!(validate("journal", "null").is_ok());
        assert!(validate("checkpoints", "[]").is_ok());
    }
}
