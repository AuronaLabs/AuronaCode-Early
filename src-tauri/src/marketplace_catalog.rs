use crate::artifact_signature::{trusted_keys, verify_detached};
use cap_std::fs::Dir;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, io::Read, path::Path};
use tauri::Manager;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogPayload {
    pub schema_version: u32,
    pub source: String,
    pub revision: u64,
    pub issued_at: u64,
    pub expires_at: u64,
    pub request: String,
    pub next_page: Option<u32>,
    pub entries: Vec<serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedCatalog {
    pub key_id: String,
    pub payload: CatalogPayload,
    pub signature: String,
}

pub fn request_key(url: &url::Url) -> String {
    let mut pairs = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    pairs.sort();
    let query = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(pairs)
        .finish();
    if query.is_empty() {
        url.path().into()
    } else {
        format!("{}?{query}", url.path())
    }
}

pub fn verify(
    catalog: &SignedCatalog,
    source: &str,
    request: &str,
    minimum: u64,
    now: u64,
    allow_expired: bool,
    keys: &HashMap<String, String>,
) -> Result<bool, String> {
    let payload = &catalog.payload;
    if payload.schema_version != 1
        || payload.source != source
        || payload.request != request
        || payload.request.len() > 8192
        || payload.revision < minimum
        || payload.issued_at > now
        || payload.expires_at <= payload.issued_at
        || (!allow_expired && payload.expires_at <= now)
        || payload.entries.len() > 256
        || payload.entries.iter().any(|entry| !entry.is_object())
    {
        return Err(
            "[catalog.binding] Invalid catalog source, revision, validity or entries".into(),
        );
    }
    let url = url::Url::parse(&format!("{source}{request}"))
        .map_err(|_| "[catalog.request] Invalid catalog request")?;
    if url.origin().ascii_serialization() != source
        || request_key(&url) != request
        || !matches!(url.path(), "/extensions" | "/api/extensions")
    {
        return Err("[catalog.request] Catalog request is not canonical".into());
    }
    let page = url
        .query_pairs()
        .find(|(key, _)| key == "page")
        .map(|(_, value)| value.parse::<u32>())
        .transpose()
        .map_err(|_| "[catalog.page] Invalid page")?
        .unwrap_or(1);
    if page == 0
        || page > 10000
        || payload
            .next_page
            .is_some_and(|next| next != page + 1 || next > 10000)
    {
        return Err("[catalog.page] Invalid next page".into());
    }
    verify_detached(payload, &catalog.key_id, &catalog.signature, keys)?;
    Ok(payload.expires_at <= now)
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn directory(app: &tauri::AppHandle) -> Result<Dir, String> {
    use cap_fs_ext::DirExt;
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let root =
        Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(|e| e.to_string())?;
    if let Err(error) = root.create_dir("catalog-secure") {
        if error.kind() != std::io::ErrorKind::AlreadyExists {
            return Err(error.to_string());
        }
    }
    root.open_dir_nofollow("catalog-secure")
        .map_err(|_| "[catalog.link] Catalog storage is unavailable or is a link".into())
}

fn filename(source: &str) -> String {
    format!("{:x}.json", Sha256::digest(source.as_bytes()))
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogCache {
    pages: Vec<SignedCatalog>,
}

impl CatalogCache {
    fn revision(
        &self,
        source: &str,
        timestamp: u64,
        keys: &HashMap<String, String>,
    ) -> Result<u64, String> {
        if self.pages.is_empty() || self.pages.len() > 16 {
            return Err("[catalog.corrupt] Invalid cached page count".into());
        }
        let revision = self.pages[0].payload.revision;
        let mut requests = std::collections::HashSet::new();
        for catalog in &self.pages {
            verify(
                catalog,
                source,
                &catalog.payload.request,
                revision,
                timestamp,
                true,
                keys,
            )?;
            if catalog.payload.revision != revision || !requests.insert(&catalog.payload.request) {
                return Err("[catalog.corrupt] Mixed revisions or duplicate cached pages".into());
            }
        }
        Ok(revision)
    }

    fn update(&mut self, catalog: SignedCatalog) -> Result<(), String> {
        let revision = catalog.payload.revision;
        if self
            .pages
            .first()
            .is_some_and(|page| page.payload.revision < revision)
        {
            self.pages.clear();
        }
        if let Some(previous) = self
            .pages
            .iter()
            .position(|page| page.payload.request == catalog.payload.request)
        {
            if serde_jcs::to_vec(&self.pages[previous].payload).map_err(|e| e.to_string())?
                != serde_jcs::to_vec(&catalog.payload).map_err(|e| e.to_string())?
            {
                return Err(
                    "[catalog.revision] A catalog page changed without advancing its revision"
                        .into(),
                );
            }
            self.pages.remove(previous);
        }
        if self.pages.len() >= 16 {
            self.pages.remove(0);
        }
        self.pages.push(catalog);
        Ok(())
    }
}

fn read(dir: &Dir, source: &str) -> Result<Option<CatalogCache>, String> {
    let file = match crate::scoped_file::open(dir, Path::new(&filename(source))) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    file.take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("[catalog.quota] Cached catalog exceeds 4 MiB".into());
    }
    serde_json::from_slice(&bytes).map(Some).map_err(|_| {
        "[catalog.corrupt] Cached catalog is malformed; retained for inspection".into()
    })
}

static CACHE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn installation_revision(
    app: &tauri::AppHandle,
    source: &str,
    id: &str,
    version: &str,
) -> Result<u64, String> {
    let dir = directory(app)?;
    let cache = read(&dir, source)?
        .ok_or("[catalog.required] A current signed catalog is required for installation")?;
    let keys = trusted_keys()?;
    let timestamp = now();
    let revision = cache.revision(source, timestamp, &keys)?;
    for catalog in &cache.pages {
        if catalog.payload.expires_at > timestamp
            && catalog.payload.entries.iter().any(|entry| {
                entry.get("id").and_then(serde_json::Value::as_str) == Some(id)
                    && entry.get("version").and_then(serde_json::Value::as_str) == Some(version)
            })
        {
            return Ok(revision);
        }
    }
    Err("[catalog.expired] This package version is absent from the current signed catalog; refresh before installing".into())
}

pub fn retain(
    app: &tauri::AppHandle,
    catalog: SignedCatalog,
    source: &str,
    request: &str,
) -> Result<(), String> {
    let _guard = CACHE_LOCK
        .lock()
        .map_err(|_| "[catalog.state] Catalog cache unavailable")?;
    let dir = directory(app)?;
    let keys = trusted_keys()?;
    let mut cache = read(&dir, source)?.unwrap_or_default();
    let minimum = if cache.pages.is_empty() {
        0
    } else {
        cache.revision(source, now(), &keys)?
    };
    verify(&catalog, source, request, minimum, now(), false, &keys)?;
    cache.update(catalog)?;
    let data = serde_json::to_vec(&cache).map_err(|e| e.to_string())?;
    if data.len() > 4 * 1024 * 1024 {
        return Err("[catalog.quota] Catalog exceeds 4 MiB".into());
    }
    if dir.entries().map_err(|e| e.to_string())?.count() >= 16 && read(&dir, source)?.is_none() {
        return Err("[catalog.quota] Catalog source quota reached".into());
    }
    crate::scoped_file::write(&dir, Path::new(&filename(source)), &data)
}

#[tauri::command]
pub async fn marketplace_cached_catalog(
    app: tauri::AppHandle,
    source: String,
) -> Result<Option<serde_json::Value>, String> {
    let request = request_key(&url::Url::parse(&source).map_err(|_| "[catalog.url] Invalid URL")?);
    let source = crate::marketplace::catalog_source(&source)?;
    tokio::task::spawn_blocking(move || {
        let Some(cache) = read(&directory(&app)?, &source)? else {
            return Ok(None);
        };
        let keys = trusted_keys()?;
        let revision = cache.revision(&source, now(), &keys)?;
        let Some(catalog) = cache
            .pages
            .into_iter()
            .find(|page| page.payload.request == request)
        else {
            return Ok(None);
        };
        let expired = verify(&catalog, &source, &request, revision, now(), true, &keys)?;
        Ok(Some(response(&catalog, expired)))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn response(catalog: &SignedCatalog, expired: bool) -> serde_json::Value {
    serde_json::json!({ "data": catalog.payload.entries, "pagination": { "nextPage": catalog.payload.next_page, "hasMore": catalog.payload.next_page.is_some() },
        "cache": { "expired": expired, "revision": catalog.payload.revision, "source": catalog.payload.source, "verified": true } })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use ed25519_dalek::{Signer, SigningKey};

    fn fixture(raw: &str) -> (HashMap<String, String>, SignedCatalog) {
        let value: serde_json::Value = serde_json::from_str(raw).unwrap();
        (
            serde_json::from_value(value["keys"].clone()).unwrap(),
            serde_json::from_value(value["catalog"].clone()).unwrap(),
        )
    }

    #[test]
    fn independent_openssl_fixture_verifies_and_tampered_fixture_fails() {
        let (keys, catalog) = fixture(include_str!(
            "../resources/security-fixtures/catalog-valid.json"
        ));
        assert!(!verify(
            &catalog,
            &catalog.payload.source,
            &catalog.payload.request,
            8,
            150,
            false,
            &keys
        )
        .unwrap());
        let (_, changed) = fixture(include_str!(
            "../resources/security-fixtures/catalog-tampered.json"
        ));
        assert!(verify(
            &changed,
            &changed.payload.source,
            &changed.payload.request,
            8,
            150,
            false,
            &keys
        )
        .is_err());
    }

    #[test]
    fn cached_pages_are_bounded_and_revision_changes_invalidate_old_pages() {
        let mut cache = CatalogCache::default();
        for page in 1..=100 {
            let (_, mut catalog) = fixture(include_str!(
                "../resources/security-fixtures/catalog-valid.json"
            ));
            catalog.payload.request = format!("/api/extensions?page={page}");
            cache.update(catalog).unwrap();
            assert!(cache.pages.len() <= 16);
        }
        let (_, mut catalog) = fixture(include_str!(
            "../resources/security-fixtures/catalog-valid.json"
        ));
        catalog.payload.revision = 9;
        cache.update(catalog).unwrap();
        assert_eq!(cache.pages.len(), 1);
        let (_, mut changed) = fixture(include_str!(
            "../resources/security-fixtures/catalog-valid.json"
        ));
        changed.payload.revision = 9;
        changed.payload.entries.clear();
        assert!(cache.update(changed).is_err());
    }

    #[test]
    fn cache_rejects_tampering_cross_origin_and_rollback_and_marks_expiry() {
        let key = SigningKey::from_bytes(&[42; 32]);
        let keys = HashMap::from([(
            "fixture".into(),
            STANDARD.encode(key.verifying_key().to_bytes()),
        )]);
        let mut catalog = SignedCatalog {
            key_id: "fixture".into(),
            signature: String::new(),
            payload: CatalogPayload {
                schema_version: 1,
                source: "https://marketplace.aurona.cc".into(),
                revision: 8,
                issued_at: 100,
                expires_at: 200,
                request: "/api/extensions?page=1".into(),
                next_page: Some(2),
                entries: vec![serde_json::json!({ "id": "test.extension", "version": "1.0.0" })],
            },
        };
        catalog.signature = STANDARD.encode(
            key.sign(&serde_jcs::to_vec(&catalog.payload).unwrap())
                .to_bytes(),
        );
        let source = "https://marketplace.aurona.cc";
        let request = "/api/extensions?page=1";
        assert!(!verify(&catalog, source, request, 8, 150, false, &keys).unwrap());
        assert!(verify(&catalog, source, request, 9, 150, false, &keys).is_err());
        assert!(verify(
            &catalog,
            source,
            "/api/extensions?page=2",
            8,
            150,
            false,
            &keys
        )
        .is_err());
        assert!(verify(
            &catalog,
            "https://other.test",
            request,
            0,
            150,
            false,
            &keys
        )
        .is_err());
        assert!(verify(&catalog, source, request, 8, 201, false, &keys).is_err());
        assert!(verify(&catalog, source, request, 8, 201, true, &keys).unwrap());
        catalog.payload.entries[0]["version"] = serde_json::json!("2.0.0");
        assert!(verify(&catalog, source, request, 8, 150, false, &keys).is_err());
    }
}
