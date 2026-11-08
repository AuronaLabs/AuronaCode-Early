use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactPayload {
    pub schema_version: u32,
    pub publisher: String,
    pub extension_id: String,
    pub version: String,
    pub platform: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub source: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub catalog_revision: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedArtifact {
    pub key_id: String,
    pub payload: ArtifactPayload,
    pub signature: String,
}

pub fn verify_detached<T: Serialize>(
    payload: &T,
    key_id: &str,
    signature: &str,
    keys: &HashMap<String, String>,
) -> Result<(), String> {
    let public_key = keys
        .get(key_id)
        .ok_or("[signature.key] Unknown signing key")?;
    let key: [u8; 32] = STANDARD
        .decode(public_key)
        .map_err(|_| "[signature.key] Invalid public key")?
        .try_into()
        .map_err(|_| "[signature.key] Invalid public key length")?;
    if signature.len() > 128 {
        return Err("[signature.invalid] Signature exceeds limit".into());
    }
    let signature = Signature::from_slice(
        &STANDARD
            .decode(signature)
            .map_err(|_| "[signature.invalid] Malformed signature")?,
    )
    .map_err(|_| "[signature.invalid] Invalid signature length")?;
    let bytes = serde_jcs::to_vec(payload).map_err(|e| e.to_string())?;
    VerifyingKey::from_bytes(&key)
        .map_err(|_| "[signature.key] Invalid public key")?
        .verify_strict(&bytes, &signature)
        .map_err(|_| "[signature.invalid] Signature verification failed".into())
}

pub fn trusted_keys() -> Result<HashMap<String, String>, String> {
    serde_json::from_str(option_env!("AURONA_ARTIFACT_PUBLIC_KEYS").unwrap_or("{}"))
        .map_err(|_| "[signature.config] Invalid pinned public keys".into())
}

#[allow(clippy::too_many_arguments)] // Identity fields mirror the signed artifact protocol.
pub fn verify(
    signed: &SignedArtifact,
    keys: &HashMap<String, String>,
    id: &str,
    version: &str,
    platform: &str,
    source: &str,
    min_revision: u64,
    now: u64,
) -> Result<(), String> {
    let payload = &signed.payload;
    if payload.schema_version != 1
        || payload.extension_id != id
        || payload.version != version
        || payload.platform != platform
        || payload.source != source
        || payload.catalog_revision < min_revision
        || payload.issued_at > now
        || payload.expires_at <= now
        || payload.expires_at <= payload.issued_at
        || payload.sha256.len() != 64
        || !payload.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || !id.starts_with(&format!("{}.", payload.publisher))
        || payload.size_bytes > crate::resource_limits::DOWNLOAD_BYTES
    {
        return Err("[signature.binding] Artifact identity, validity or size mismatch".into());
    }
    verify_detached(payload, &signed.key_id, &signed.signature, keys)
}

pub fn verify_bytes(payload: &ArtifactPayload, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 != payload.size_bytes
        || format!("{:x}", Sha256::digest(bytes)) != payload.sha256.to_ascii_lowercase()
    {
        return Err("[signature.hash] Artifact bytes do not match the signed descriptor".into());
    }
    Ok(())
}

/// A local package may carry a bounded detached descriptor beside it:
/// example.aurx.sig.json. No catalog or network access is needed.
pub fn local_signature(
    path: &std::path::Path,
    sha256: &str,
    size: u64,
) -> Result<Option<ArtifactPayload>, String> {
    use std::io::Read;
    let mut signature_path = path.as_os_str().to_os_string();
    signature_path.push(".sig.json");
    let file = match std::fs::File::open(std::path::PathBuf::from(signature_path)) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut descriptor = Vec::new();
    file.take(65537)
        .read_to_end(&mut descriptor)
        .map_err(|e| e.to_string())?;
    if descriptor.len() > 65536 {
        return Err("[signature.schema] Local signature exceeds 64 KiB".into());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    verify_local_descriptor(&descriptor, sha256, size, &trusted_keys()?, now).map(Some)
}

fn verify_local_descriptor(
    descriptor: &[u8],
    sha256: &str,
    size: u64,
    keys: &HashMap<String, String>,
    now: u64,
) -> Result<ArtifactPayload, String> {
    let signed: SignedArtifact = serde_json::from_slice(descriptor)
        .map_err(|_| "[signature.schema] Invalid local signature descriptor")?;
    let platform = if signed.payload.platform == "any" {
        "any"
    } else {
        crate::toolchains::host_artifact_platform()
    };
    verify(
        &signed,
        keys,
        &signed.payload.extension_id,
        &signed.payload.version,
        platform,
        &signed.payload.source,
        0,
        now,
    )?;
    if signed.payload.size_bytes != size || !signed.payload.sha256.eq_ignore_ascii_case(sha256) {
        return Err("[signature.hash] Selected package differs from its signature".into());
    }
    Ok(signed.payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn local_descriptor_binds_the_selected_package_and_trusted_publisher() {
        let key = SigningKey::from_bytes(&[17; 32]);
        let bytes = b"local package";
        let hash = format!("{:x}", Sha256::digest(bytes));
        let payload = ArtifactPayload {
            schema_version: 1,
            publisher: "test".into(),
            extension_id: "test.local".into(),
            version: "1.0.0".into(),
            platform: "any".into(),
            sha256: hash.clone(),
            size_bytes: bytes.len() as u64,
            source: "local".into(),
            issued_at: 100,
            expires_at: 200,
            catalog_revision: 0,
        };
        let mut signed = SignedArtifact {
            key_id: "local-test".into(),
            signature: STANDARD.encode(key.sign(&serde_jcs::to_vec(&payload).unwrap()).to_bytes()),
            payload,
        };
        let keys = HashMap::from([(
            "local-test".into(),
            STANDARD.encode(key.verifying_key().to_bytes()),
        )]);
        let descriptor = serde_json::to_vec(&signed).unwrap();
        assert!(
            verify_local_descriptor(&descriptor, &hash, bytes.len() as u64, &keys, 150).is_ok()
        );
        assert!(verify_local_descriptor(
            &descriptor,
            &hash,
            bytes.len() as u64,
            &HashMap::new(),
            150
        )
        .is_err());
        assert!(
            verify_local_descriptor(&descriptor, &hash, bytes.len() as u64, &keys, 200).is_err()
        );
        assert!(verify_local_descriptor(
            &descriptor,
            &"0".repeat(64),
            bytes.len() as u64,
            &keys,
            150
        )
        .is_err());
        assert!(
            verify_local_descriptor(&descriptor, &hash, bytes.len() as u64 + 1, &keys, 150)
                .is_err()
        );
        signed.payload.version = "2.0.0".into();
        assert!(verify_local_descriptor(
            &serde_json::to_vec(&signed).unwrap(),
            &hash,
            bytes.len() as u64,
            &keys,
            150
        )
        .is_err());
    }

    #[test]
    fn local_signature_is_optional_but_malformed_or_oversized_sidecars_fail() {
        let directory = tempfile::tempdir().unwrap();
        let package = directory.path().join("sample.aurx");
        let signature = directory.path().join("sample.aurx.sig.json");
        assert!(local_signature(&package, "", 0).unwrap().is_none());
        std::fs::write(&signature, b"not JSON").unwrap();
        assert!(local_signature(&package, "", 0)
            .unwrap_err()
            .contains("signature.schema"));
        std::fs::write(&signature, vec![b' '; 65537]).unwrap();
        assert!(local_signature(&package, "", 0)
            .unwrap_err()
            .contains("64 KiB"));
    }

    #[test]
    fn binds_identity_source_revision_validity_and_actual_bytes() {
        let key = SigningKey::from_bytes(&[42; 32]);
        let bytes = b"artifact fixture";
        let payload = ArtifactPayload {
            schema_version: 1,
            publisher: "test".into(),
            extension_id: "test.extension".into(),
            version: "1.0.0".into(),
            platform: "fixture".into(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            size_bytes: bytes.len() as u64,
            source: "https://marketplace.aurona.cc".into(),
            issued_at: 100,
            expires_at: 200,
            catalog_revision: 8,
        };
        let signature = STANDARD.encode(key.sign(&serde_jcs::to_vec(&payload).unwrap()).to_bytes());
        let mut signed = SignedArtifact {
            key_id: "test-only".into(),
            payload,
            signature,
        };
        let keys = HashMap::from([(
            "test-only".into(),
            STANDARD.encode(key.verifying_key().to_bytes()),
        )]);
        assert!(verify(
            &signed,
            &keys,
            "test.extension",
            "1.0.0",
            "fixture",
            "https://marketplace.aurona.cc",
            8,
            150
        )
        .is_ok());
        assert!(verify_bytes(&signed.payload, bytes).is_ok());
        assert!(verify_bytes(&signed.payload, b"different").is_err());
        assert!(verify(
            &signed,
            &keys,
            "test.other",
            "1.0.0",
            "fixture",
            "https://marketplace.aurona.cc",
            8,
            150
        )
        .is_err());
        assert!(verify(
            &signed,
            &keys,
            "test.extension",
            "1.0.0",
            "fixture",
            "https://marketplace.aurona.cc",
            9,
            150
        )
        .is_err());
        assert!(verify(
            &signed,
            &keys,
            "test.extension",
            "1.0.0",
            "fixture",
            "https://marketplace.aurona.cc",
            8,
            200
        )
        .is_err());
        signed.payload.size_bytes += 1;
        assert!(verify(
            &signed,
            &keys,
            "test.extension",
            "1.0.0",
            "fixture",
            "https://marketplace.aurona.cc",
            8,
            150
        )
        .is_err());
    }
}
