use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[cfg(not(feature = "audit-harness"))]
const SERVICE: &str = "cc.aurona.code.ai";
#[cfg(feature = "audit-harness")]
const SERVICE: &str = "cc.aurona.code.audit0414.ai";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub provider: Option<String>,
    pub credential_id: String,
    pub has_credential: bool,
    pub protocol: String,
}

#[derive(Default)]
pub struct AiProfileState {
    profiles: Mutex<HashMap<String, Profile>>,
    approved: Mutex<HashMap<String, (String, u64)>>,
    migration: Mutex<()>,
}

impl AiProfileState {
    pub fn revoke_session(&self) {
        if let Ok(mut approved) = self.approved.lock() {
            approved.clear();
        }
    }
    pub fn validate_grant(
        &self,
        app: &tauri::AppHandle,
        profile: &Profile,
        generation: u64,
    ) -> Result<(), String> {
        self.validate_grant_at(
            profile,
            generation,
            app.state::<crate::commands::fs::WorkspaceState>()
                .generation(),
        )
    }

    fn validate_grant_at(
        &self,
        profile: &Profile,
        generation: u64,
        current_generation: u64,
    ) -> Result<(), String> {
        let fingerprint = fingerprint(profile)?;
        if current_generation != generation
            || self
                .profiles
                .lock()
                .map_err(|e| e.to_string())?
                .get(&profile.id)
                .map(fingerprint_profile)
                != Some(Some(fingerprint.clone()))
            || self
                .approved
                .lock()
                .map_err(|e| e.to_string())?
                .get(&profile.id)
                != Some(&(fingerprint, generation))
        {
            return Err(
                "[ai.authorization_revoked] Workspace or profile authorization changed".into(),
            );
        }
        Ok(())
    }
    pub async fn wait_for_revocation(
        &self,
        app: &tauri::AppHandle,
        profile: &Profile,
        generation: u64,
    ) {
        loop {
            if self.validate_grant(app, profile, generation).is_err() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }
}

struct PendingCredential {
    entry: keyring::Entry,
    committed: bool,
}

impl PendingCredential {
    fn store(id: &str, key: &str) -> Result<Self, String> {
        Self::store_entry(credential(id)?, key)
    }
    fn store_entry(entry: keyring::Entry, key: &str) -> Result<Self, String> {
        let pending = Self {
            entry,
            committed: false,
        };
        pending
            .entry
            .set_password(key)
            .map_err(|_| "[ai.keyring] Credential could not be stored".to_string())?;
        if pending
            .entry
            .get_password()
            .map_err(|_| "[ai.keyring] Credential could not be verified".to_string())?
            != key
        {
            return Err("[ai.keyring] Credential verification failed".into());
        }
        Ok(pending)
    }
}

impl Drop for PendingCredential {
    fn drop(&mut self) {
        if !self.committed {
            let _ = self.entry.delete_credential();
        }
    }
}

fn credential(id: &str) -> Result<keyring::Entry, String> {
    if id.is_empty()
        || id.len() > 256
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err("[ai.profile_id] Invalid profile ID".into());
    }
    #[cfg(test)]
    if let Some(entry) = TEST_CREDENTIAL_STORE.with(|store| {
        use keyring_core::api::CredentialStoreApi;
        store.borrow().as_ref().map(|store| {
            store
                .build(SERVICE, id, None)
                .map(|inner| keyring::Entry { inner })
                .map_err(|_| "[ai.keyring] Test credential failure".to_string())
        })
    }) {
        return entry;
    }
    keyring::Entry::new(SERVICE, id)
        .map_err(|_| "[ai.keyring] System credential store is unavailable".into())
}

#[cfg(test)]
thread_local! {
    static TEST_CREDENTIAL_STORE: std::cell::RefCell<Option<std::sync::Arc<keyring_core::mock::Store>>> = const { std::cell::RefCell::new(None) };
}

fn load(app: &tauri::AppHandle, state: &AiProfileState) -> Result<(), String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("ai-profiles.json");
    let mut profiles = state.profiles.lock().map_err(|e| e.to_string())?;
    if profiles.is_empty() && path.exists() {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() > 1024 * 1024 {
            return Err("[resource.limit] AI profile metadata is too large".into());
        }
        *profiles = serde_json::from_reader(file)
            .map_err(|_| "[ai.profiles] Invalid profile metadata".to_string())?;
    }
    cleanup_retired(app, &profiles)?;
    Ok(())
}

fn retirement_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("ai-retired-credentials.json"))
}

fn retired_credentials(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let path = retirement_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 1024 * 1024 {
        return Err("[resource.limit] Credential retirement journal is too large".into());
    }
    serde_json::from_reader(file)
        .map_err(|_| "[ai.keyring] Invalid credential retirement journal".into())
}

fn retire_before_commit(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    credential(id)?;
    let mut ids = retired_credentials(app)?;
    if !ids.iter().any(|saved| saved == id) {
        ids.push(id.into());
    }
    if ids.len() > 1024 {
        return Err("[resource.limit] Credential cleanup queue is full".into());
    }
    crate::atomic_store::replace(
        &retirement_path(app)?,
        &serde_json::to_vec(&ids).map_err(|e| e.to_string())?,
    )
}

fn cleanup_retired(
    app: &tauri::AppHandle,
    profiles: &HashMap<String, Profile>,
) -> Result<(), String> {
    let ids = retired_credentials(app)?;
    if ids.is_empty() {
        return Ok(());
    }
    let mut pending = Vec::new();
    for id in ids {
        if profiles.values().any(|profile| profile.credential_id == id)
            || !matches!(
                credential(&id)?.delete_credential(),
                Ok(()) | Err(keyring::Error::NoEntry)
            )
        {
            pending.push(id);
        }
    }
    crate::atomic_store::replace(
        &retirement_path(app)?,
        &serde_json::to_vec(&pending).map_err(|e| e.to_string())?,
    )
}

fn persist(app: &tauri::AppHandle, profiles: &HashMap<String, Profile>) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("ai-profiles.json");
    let bytes = serde_json::to_vec(profiles).map_err(|e| e.to_string())?;
    crate::atomic_store::replace(&path, &bytes)
}

fn credential_id(profile: &Profile) -> String {
    format!("{}.{:032x}", profile.id, rand::random::<u128>())
}

fn fingerprint(profile: &Profile) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(profile).map_err(|e| e.to_string())?)
    ))
}

async fn confirm_endpoint(app: &tauri::AppHandle, profile: &Profile) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let (title, body) =
        crate::authorization_dialogs::text(app, "ai", &[("endpoint", &profile.base_url)]);
    app.dialog()
        .message(body)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancel)
        .show(move |approved| {
            let _ = sender.send(approved);
        });
    match tokio::time::timeout(std::time::Duration::from_secs(120), receiver).await {
        Ok(Ok(true)) => Ok(()),
        _ => Err("[ai.authorization] Endpoint authorization cancelled".into()),
    }
}

#[tauri::command]
pub async fn ai_profile_save(
    app: tauri::AppHandle,
    state: State<'_, AiProfileState>,
    mut profile: Profile,
    api_key: Option<String>,
) -> Result<Profile, String> {
    let workspace = app.state::<crate::commands::fs::WorkspaceState>();
    let generation = workspace.generation();
    credential(&profile.id)?;
    if profile.id.len() > 128 {
        return Err("[ai.profile_id] Invalid profile ID".into());
    }
    let endpoint = crate::network_policy::validate_ai_endpoint(&profile.base_url)?;
    profile.base_url = endpoint.to_string().trim_end_matches('/').to_string();
    if profile.name.len() > 256
        || profile.model.is_empty()
        || profile.model.len() > 256
        || profile.protocol != "responses"
    {
        return Err("[ai.profile] Invalid profile metadata".into());
    }
    load(&app, &state)?;
    let old = state
        .profiles
        .lock()
        .map_err(|e| e.to_string())?
        .get(&profile.id)
        .cloned();
    let changed = old
        .as_ref()
        .is_none_or(|old| old.base_url != profile.base_url);
    if changed {
        if api_key.as_ref().is_none_or(|key| key.is_empty()) {
            return Err(
                "[ai.credential_binding] A new endpoint requires a separate credential".into(),
            );
        }
        confirm_endpoint(&app, &profile).await?;
    }
    profile.credential_id = if api_key.as_ref().is_some_and(|key| !key.is_empty()) {
        credential_id(&profile)
    } else {
        old.as_ref()
            .ok_or("[ai.credential_binding] No saved credential")?
            .credential_id
            .clone()
    };
    let mut pending_credential = None;
    if let Some(key) = api_key.filter(|key| !key.is_empty()) {
        if key.len() > 8192 {
            return Err("[resource.limit] Credential is too long".into());
        }
        pending_credential = Some(PendingCredential::store(&profile.credential_id, &key)?);
        profile.has_credential = true;
    } else {
        profile.has_credential = credential(&profile.credential_id)?.get_password().is_ok();
    }
    if !profile.has_credential {
        return Err("[ai.keyring] This profile has no stored credential".into());
    }
    let mut profiles = state.profiles.lock().map_err(|e| e.to_string())?;
    if workspace.generation() != generation
        || profiles.get(&profile.id).map(fingerprint_profile)
            != old.as_ref().map(fingerprint_profile)
    {
        return Err("[ai.profile_changed] Profile or workspace changed during approval".into());
    }
    if !profiles.contains_key(&profile.id) && profiles.len() >= 64 {
        return Err("[resource.limit] AI profile limit reached".into());
    }
    let mut next = profiles.clone();
    next.insert(profile.id.clone(), profile.clone());
    if let Some(old) = old
        .as_ref()
        .filter(|old| old.credential_id != profile.credential_id)
    {
        retire_before_commit(&app, &old.credential_id)?;
    }
    persist(&app, &next)?;
    if let Some(pending) = pending_credential.as_mut() {
        pending.committed = true;
    }
    *profiles = next;
    state
        .approved
        .lock()
        .map_err(|e| e.to_string())?
        .insert(profile.id.clone(), (fingerprint(&profile)?, generation));
    cleanup_retired(&app, &profiles)?;
    Ok(profile)
}

pub async fn resolve(
    app: &tauri::AppHandle,
    state: &AiProfileState,
    id: &str,
) -> Result<(Profile, String, u64), String> {
    let workspace = app.state::<crate::commands::fs::WorkspaceState>();
    let generation = workspace.generation();
    load(app, state)?;
    let profile = state
        .profiles
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .cloned()
        .ok_or_else(|| "[ai.authorization] Profile is not registered".to_string())?;
    let fingerprint = (fingerprint(&profile)?, generation);
    let needs_approval =
        state.approved.lock().map_err(|e| e.to_string())?.get(id) != Some(&fingerprint);
    if needs_approval {
        confirm_endpoint(app, &profile).await?;
        if workspace.generation() != generation {
            return Err("[ai.authorization_revoked] Workspace changed during approval".into());
        }
        state
            .approved
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.to_string(), fingerprint);
    }
    if state
        .profiles
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .map(fingerprint_profile)
        != Some(fingerprint_profile(&profile))
    {
        return Err("[ai.profile_changed] Profile changed during authorization".into());
    }
    let key = credential(&profile.credential_id)?
        .get_password()
        .map_err(|_| "[ai.keyring] Stored credential is unavailable".to_string())?;
    state.validate_grant(app, &profile, generation)?;
    Ok((profile, key, generation))
}

#[tauri::command]
pub fn ai_profile_delete(
    app: tauri::AppHandle,
    state: State<'_, AiProfileState>,
    profile_id: String,
) -> Result<(), String> {
    load(&app, &state)?;
    let mut profiles = state.profiles.lock().map_err(|e| e.to_string())?;
    let mut next = profiles.clone();
    let removed = next.remove(&profile_id);
    if let Some(removed) = removed.as_ref() {
        retire_before_commit(&app, &removed.credential_id)?;
    }
    state
        .approved
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&profile_id);
    persist(&app, &next)?;
    *profiles = next;
    cleanup_retired(&app, &profiles)
}

fn fingerprint_profile(profile: &Profile) -> Option<String> {
    fingerprint(profile).ok()
}

fn read_config(path: &std::path::Path) -> Result<serde_json::Value, String> {
    let file = std::fs::File::open(path)
        .map_err(|_| "[ai.migration] Configuration is unavailable".to_string())?;
    let mut bytes = Vec::new();
    file.take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "[ai.migration] Configuration read failed".to_string())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("[resource.limit] Configuration exceeds 4 MiB".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "[ai.migration] Configuration is malformed".into())
}

fn migrate_config(
    value: &mut serde_json::Value,
    profiles: &mut HashMap<String, Profile>,
    pending: &mut Vec<PendingCredential>,
) -> Result<bool, String> {
    let Some(ai) = value
        .get_mut("ai")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return Ok(false);
    };
    let mut changed = false;
    if ai
        .get("apiKey")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|key| !key.is_empty())
    {
        let mut legacy = serde_json::json!({"id":"default","name":"","baseUrl":ai.get("baseUrl"),"model":ai.get("model"),"provider":ai.get("provider"),"apiKey":ai.get("apiKey")});
        let list = ai
            .entry("profiles")
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut()
            .ok_or("[ai.migration] Invalid profile list")?;
        if list
            .iter()
            .any(|item| item.get("id").and_then(serde_json::Value::as_str) == Some("default"))
        {
            legacy["id"] = serde_json::json!(format!("legacy-{:032x}", rand::random::<u128>()));
        }
        list.push(legacy);
    }
    if let Some(items) = ai
        .get_mut("profiles")
        .and_then(serde_json::Value::as_array_mut)
    {
        if items.len() > 64 {
            return Err("[resource.limit] AI profile limit reached".into());
        }
        let mut ids = std::collections::HashSet::new();
        for item in items.iter() {
            let id = item
                .get("id")
                .and_then(serde_json::Value::as_str)
                .ok_or("[ai.migration] Missing profile ID")?;
            if !ids.insert(id.to_owned()) {
                return Err(
                    "[ai.migration] Duplicate profile IDs; original configuration preserved".into(),
                );
            }
        }
        for item in items {
            let Some(key) = item
                .get("apiKey")
                .and_then(serde_json::Value::as_str)
                .filter(|key| !key.is_empty())
                .map(str::to_owned)
            else {
                continue;
            };
            if key.len() > 8192 {
                return Err("[resource.limit] Credential is too long".into());
            }
            let mut profile = Profile {
                id: item
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .ok_or("[ai.migration] Missing profile ID")?
                    .into(),
                name: item
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .into(),
                base_url: crate::network_policy::validate_ai_endpoint(
                    item.get("baseUrl")
                        .and_then(serde_json::Value::as_str)
                        .ok_or("[ai.migration] Missing endpoint")?,
                )?
                .to_string()
                .trim_end_matches('/')
                .into(),
                model: item
                    .get("model")
                    .and_then(serde_json::Value::as_str)
                    .ok_or("[ai.migration] Missing model")?
                    .into(),
                provider: item
                    .get("provider")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned),
                credential_id: String::new(),
                has_credential: true,
                protocol: "responses".into(),
            };
            credential(&profile.id)?;
            // A retry after metadata commit reuses its verified credential instead of
            // replacing an existing profile or leaving another orphan in the keyring.
            if let Some(existing) = profiles.get(&profile.id) {
                let saved = credential(&existing.credential_id)?
                    .get_password()
                    .map_err(|_| "[ai.keyring] Migrated credential is unavailable".to_string())?;
                if existing.base_url == profile.base_url
                    && existing.model == profile.model
                    && saved == key
                {
                    profile = existing.clone();
                } else {
                    profile.id = format!("recovered-{:032x}", rand::random::<u128>());
                    profile.credential_id = credential_id(&profile);
                    pending.push(PendingCredential::store(&profile.credential_id, &key)?);
                }
            } else {
                profile.credential_id = credential_id(&profile);
                pending.push(PendingCredential::store(&profile.credential_id, &key)?);
            }
            *item = serde_json::to_value(&profile).map_err(|e| e.to_string())?;
            item["apiKey"] = serde_json::json!("");
            profiles.insert(profile.id.clone(), profile);
            changed = true;
        }
    }
    if ai.remove("apiKey").is_some() {
        changed = true;
    }
    Ok(changed)
}

#[tauri::command]
pub fn ai_profiles_migrate(
    app: tauri::AppHandle,
    state: State<'_, AiProfileState>,
) -> Result<serde_json::Value, String> {
    let _migration = state.migration.lock().map_err(|e| e.to_string())?;
    load(&app, &state)?;
    let directory = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let path = directory.join("user-config.json");
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let mut value = read_config(&path)?;
    let mut profiles = state.profiles.lock().map_err(|e| e.to_string())?;
    let mut next = profiles.clone();
    let mut pending = Vec::new();
    let changed = migrate_config(&mut value, &mut next, &mut pending)?;
    let mut old_files = Vec::new();
    for name in ["user-config.json.aurona.bak", "user-config.json.aurona.tmp"] {
        let old_path = directory.join(name);
        if old_path.exists() {
            let mut old_value = read_config(&old_path)?;
            if let Some(items) = old_value
                .pointer_mut("/ai/profiles")
                .and_then(serde_json::Value::as_array_mut)
            {
                for item in items {
                    if item
                        .get("apiKey")
                        .and_then(serde_json::Value::as_str)
                        .is_some_and(|key| !key.is_empty())
                    {
                        let original = item
                            .get("id")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("missing");
                        item["id"] = serde_json::json!(format!(
                            "recovered-{:x}",
                            Sha256::digest(format!("{name}\0{original}"))
                        ));
                    }
                }
            }
            // Validate and preserve credentials in any application-managed interrupted write.
            if migrate_config(&mut old_value, &mut next, &mut pending)? {
                old_files.push((old_path, old_value));
            }
        }
    }
    if next.len() > 64 {
        return Err("[resource.limit] Recovered AI profiles exceed the profile limit".into());
    }
    persist(&app, &next)?;
    for credential in &mut pending {
        credential.committed = true;
    }
    *profiles = next;
    for (old_path, old_value) in old_files {
        crate::atomic_store::replace(
            &old_path,
            &serde_json::to_vec(&old_value).map_err(|e| e.to_string())?,
        )?;
    }
    if changed {
        crate::atomic_store::replace(
            &path,
            &serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
        )?;
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestStore;
    impl TestStore {
        fn new() -> Self {
            TEST_CREDENTIAL_STORE.with(|store| {
                *store.borrow_mut() = Some(keyring_core::mock::Store::new().unwrap())
            });
            Self
        }
    }
    impl Drop for TestStore {
        fn drop(&mut self) {
            TEST_CREDENTIAL_STORE.with(|store| store.borrow_mut().take());
        }
    }

    fn legacy() -> serde_json::Value {
        serde_json::json!({"ai":{"profiles":[{"id":"first","name":"First","baseUrl":"https://api.openai.com/v1","model":"fixture","apiKey":"fixture-secret"}]}})
    }

    #[test]
    fn interrupted_migration_reuses_committed_credentials_and_preserves_conflicting_profiles() {
        let _store = TestStore::new();
        let original = legacy();
        let mut first = original.clone();
        let mut profiles = HashMap::new();
        let mut pending = Vec::new();
        migrate_config(&mut first, &mut profiles, &mut pending).unwrap();
        let saved_id = profiles["first"].credential_id.clone();
        for credential in &mut pending {
            credential.committed = true;
        }
        drop(pending);
        let mut retry = original.clone();
        let mut pending = Vec::new();
        migrate_config(&mut retry, &mut profiles, &mut pending).unwrap();
        assert!(pending.is_empty());
        assert_eq!(profiles["first"].credential_id, saved_id);
        assert_eq!(profiles.len(), 1);
        assert!(!serde_json::to_string(&retry)
            .unwrap()
            .contains("fixture-secret"));
        let mut different = original;
        different["ai"]["profiles"][0]["apiKey"] = serde_json::json!("changed-secret");
        migrate_config(&mut different, &mut profiles, &mut pending).unwrap();
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles["first"].credential_id, saved_id);
        assert_eq!(
            credential(&saved_id).unwrap().get_password().unwrap(),
            "fixture-secret"
        );
    }

    #[test]
    fn duplicate_migration_ids_fail_before_any_credential_is_written() {
        let _store = TestStore::new();
        let mut config = legacy();
        let duplicate = config["ai"]["profiles"][0].clone();
        config["ai"]["profiles"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        let mut profiles = HashMap::new();
        let mut pending = Vec::new();
        assert!(migrate_config(&mut config, &mut profiles, &mut pending)
            .unwrap_err()
            .contains("Duplicate"));
        assert!(profiles.is_empty() && pending.is_empty());
    }

    #[test]
    fn keyring_write_failure_and_uncommitted_credentials_are_retryable() {
        let _store = TestStore::new();
        let entry = credential("failed").unwrap();
        entry
            .inner
            .as_any()
            .downcast_ref::<keyring_core::mock::Cred>()
            .unwrap()
            .set_error(keyring::Error::Invalid("mock".into(), "unavailable".into()));
        assert!(PendingCredential::store_entry(entry, "secret").is_err());
        assert!(credential("failed").unwrap().get_password().is_err());
        let pending = PendingCredential::store("failed", "secret").unwrap();
        assert_eq!(
            credential("failed").unwrap().get_password().unwrap(),
            "secret"
        );
        drop(pending);
        assert!(credential("failed").unwrap().get_password().is_err());
    }

    #[test]
    fn session_grants_revoke_on_generation_configuration_and_session_changes() {
        let state = AiProfileState::default();
        let mut profile = Profile {
            id: "fixture".into(),
            name: "Fixture".into(),
            base_url: "https://api.openai.com/v1".into(),
            model: "model".into(),
            provider: None,
            credential_id: "fixture.key".into(),
            has_credential: true,
            protocol: "responses".into(),
        };
        state
            .profiles
            .lock()
            .unwrap()
            .insert(profile.id.clone(), profile.clone());
        assert!(state.validate_grant_at(&profile, 1, 1).is_err());
        state
            .approved
            .lock()
            .unwrap()
            .insert(profile.id.clone(), (fingerprint(&profile).unwrap(), 1));
        assert!(state.validate_grant_at(&profile, 1, 1).is_ok());
        assert!(state.validate_grant_at(&profile, 1, 2).is_err());
        profile.model = "changed".into();
        assert!(state.validate_grant_at(&profile, 1, 1).is_err());
        state.revoke_session();
        assert!(state.approved.lock().unwrap().is_empty());
    }
}
