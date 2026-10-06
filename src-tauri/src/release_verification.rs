use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::Path,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseArtifact {
    pub file: String,
    pub platform: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub signature: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseMetadata {
    pub schema_version: u32,
    pub version: String,
    pub channel: String,
    pub artifacts: Vec<ReleaseArtifact>,
}

pub fn updater_key(config: &serde_json::Value) -> Result<PublicKey, String> {
    let encoded = config
        .pointer("/plugins/updater/pubkey")
        .and_then(serde_json::Value::as_str)
        .ok_or("[release.key] Missing configured updater public key")?;
    let decoded = STANDARD
        .decode(encoded)
        .map_err(|_| "[release.key] Invalid encoded public key")?;
    let decoded =
        std::str::from_utf8(&decoded).map_err(|_| "[release.key] Invalid public key text")?;
    PublicKey::decode(decoded).map_err(|_| "[release.key] Invalid Minisign public key".into())
}

fn single_file(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 240
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':', '\0'])
}

pub fn validate_metadata(
    metadata: &ReleaseMetadata,
    version: &str,
    channel: &str,
) -> Result<(), String> {
    if metadata.schema_version != 1
        || metadata.version != version
        || metadata.channel != channel
        || !matches!(channel, "stable" | "pioneer")
        || metadata.artifacts.is_empty()
        || metadata.artifacts.len() > 32
    {
        return Err("[release.binding] Release version, channel or artifact count mismatch".into());
    }
    semver::Version::parse(version).map_err(|_| "[release.version] Invalid release version")?;
    let mut files = HashMap::new();
    let mut platforms = HashSet::new();
    for artifact in &metadata.artifacts {
        if !single_file(&artifact.file)
            || !platforms.insert(&artifact.platform)
            || artifact.platform.is_empty()
            || artifact.platform.len() > 64
            || artifact.size_bytes == 0
            || artifact.size_bytes > 2 * 1024 * 1024 * 1024
            || artifact.sha256.len() != 64
            || !artifact.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || artifact.signature.len() > 8192
        {
            return Err("[release.artifact] Invalid artifact identity, size or digest".into());
        }
        let identity = (&artifact.sha256, artifact.size_bytes, &artifact.signature);
        if files
            .insert(&artifact.file, identity)
            .is_some_and(|previous| previous != identity)
        {
            return Err("[release.artifact] One file has conflicting platform identities".into());
        }
    }
    Ok(())
}

pub fn verify_metadata(
    metadata: &ReleaseMetadata,
    signature: &str,
    key: &PublicKey,
    version: &str,
    channel: &str,
) -> Result<(), String> {
    validate_metadata(metadata, version, channel)?;
    let canonical = serde_jcs::to_vec(metadata).map_err(|e| e.to_string())?;
    let signature = Signature::decode(signature)
        .map_err(|_| "[release.signature] Invalid metadata signature")?;
    key.verify(&canonical, &signature, false)
        .map_err(|_| "[release.signature] Release metadata signature failed".into())
}

pub fn runtime_artifact(
    raw: &serde_json::Value,
    key: &PublicKey,
    version: &str,
    channel: &str,
    platform: &str,
    download_url: &url::Url,
    signature: &str,
) -> Result<ReleaseArtifact, String> {
    let envelope = raw
        .get("auronaReleases")
        .and_then(|releases| releases.get(platform))
        .or_else(|| raw.get("auronaRelease"))
        .ok_or("[release.metadata] Signed release metadata is required")?;
    let metadata: ReleaseMetadata = serde_json::from_value(
        envelope
            .get("metadata")
            .cloned()
            .ok_or("[release.metadata] Missing release payload")?,
    )
    .map_err(|_| "[release.metadata] Invalid release payload")?;
    let metadata_signature = envelope
        .get("signature")
        .and_then(serde_json::Value::as_str)
        .ok_or("[release.metadata] Missing metadata signature")?;
    if metadata_signature.len() > 8192 {
        return Err("[release.metadata] Metadata signature exceeds limit".into());
    }
    verify_metadata(&metadata, metadata_signature, key, version, channel)?;
    let artifact = metadata
        .artifacts
        .into_iter()
        .find(|artifact| artifact.platform == platform)
        .ok_or("[release.platform] Release does not contain this updater platform")?;
    if download_url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        != Some(artifact.file.as_str())
        || artifact.signature != signature
    {
        return Err(
            "[release.binding] Download URL or signature differs from signed metadata".into(),
        );
    }
    Ok(artifact)
}

pub fn verify_directory(
    root: &Path,
    metadata: &ReleaseMetadata,
    signature: &str,
    config: &serde_json::Value,
    version: &str,
    channel: &str,
) -> Result<(), String> {
    let key = updater_key(config)?;
    verify_metadata(metadata, signature, &key, version, channel)?;
    let dir = cap_std::fs::Dir::open_ambient_dir(root, cap_std::ambient_authority())
        .map_err(|e| e.to_string())?;
    for artifact in &metadata.artifacts {
        let mut file = crate::scoped_file::open(&dir, Path::new(&artifact.file))
            .map_err(|_| "[release.artifact] Artifact unavailable or is a link")?;
        if !file.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("[release.artifact] Artifact is not a file".into());
        }
        let signature = Signature::decode(&artifact.signature)
            .map_err(|_| "[release.signature] Invalid artifact signature")?;
        let mut verifier = key
            .verify_stream(&signature)
            .map_err(|_| "[release.signature] Artifact signature key mismatch")?;
        let mut hash = Sha256::new();
        let mut size = 0u64;
        let mut chunk = [0u8; 256 * 1024];
        loop {
            let count = file.read(&mut chunk).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            size = size
                .checked_add(count as u64)
                .ok_or("[release.size] Artifact size overflow")?;
            if size > artifact.size_bytes {
                return Err("[release.size] Artifact exceeds signed size".into());
            }
            hash.update(&chunk[..count]);
            verifier.update(&chunk[..count]);
        }
        if size != artifact.size_bytes
            || format!("{:x}", hash.finalize()) != artifact.sha256.to_ascii_lowercase()
        {
            return Err("[release.hash] Artifact differs from signed metadata".into());
        }
        verifier
            .finalize()
            .map_err(|_| "[release.signature] Artifact signature failed")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_fixture_binds_runtime_channel_artifact_and_metadata() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../resources/security-fixtures/release-valid.json"
        ))
        .unwrap();
        let metadata: ReleaseMetadata =
            serde_json::from_value(fixture["auronaRelease"]["metadata"].clone()).unwrap();
        let signature = fixture["auronaRelease"]["signature"].as_str().unwrap();
        let key = updater_key(&fixture["config"]).unwrap();
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("fixture.exe"),
            fixture["artifact"].as_str().unwrap(),
        )
        .unwrap();
        verify_directory(
            directory.path(),
            &metadata,
            signature,
            &fixture["config"],
            "0.4.14",
            "stable",
        )
        .unwrap();
        let url = url::Url::parse("https://example.test/fixture.exe").unwrap();
        let artifact_sig = &metadata.artifacts[0].signature;
        runtime_artifact(
            &fixture,
            &key,
            "0.4.14",
            "stable",
            "windows-x86_64",
            &url,
            artifact_sig,
        )
        .unwrap();
        assert!(runtime_artifact(
            &fixture,
            &key,
            "0.4.14",
            "pioneer",
            "windows-x86_64",
            &url,
            artifact_sig
        )
        .is_err());
        assert!(runtime_artifact(
            &fixture,
            &key,
            "0.4.14",
            "stable",
            "linux-x86_64",
            &url,
            artifact_sig
        )
        .is_err());
        assert!(runtime_artifact(
            &fixture,
            &key,
            "0.4.14",
            "stable",
            "windows-x86_64",
            &url,
            "replaced-signature"
        )
        .is_err());
        let mut altered = fixture.clone();
        altered["auronaRelease"]["metadata"]["artifacts"][0]["sha256"] =
            serde_json::json!("a".repeat(64));
        assert!(runtime_artifact(
            &altered,
            &key,
            "0.4.14",
            "stable",
            "windows-x86_64",
            &url,
            artifact_sig
        )
        .is_err());
        let configured: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert!(verify_directory(
            directory.path(),
            &metadata,
            signature,
            &configured,
            "0.4.14",
            "stable"
        )
        .is_err());
        std::fs::write(directory.path().join("fixture.exe"), b"tampered").unwrap();
        assert!(verify_directory(
            directory.path(),
            &metadata,
            signature,
            &fixture["config"],
            "0.4.14",
            "stable"
        )
        .is_err());
    }
    #[test]
    fn configured_key_uses_standard_minisign_untrusted_comment() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert!(updater_key(&config).is_ok());
        // A comment is metadata; it is not a reason to reject a valid key packet.
        let mut decoded = STANDARD
            .decode(
                config
                    .pointer("/plugins/updater/pubkey")
                    .unwrap()
                    .as_str()
                    .unwrap(),
            )
            .unwrap();
        decoded[0] = b'U';
        let key_text = String::from_utf8(decoded).unwrap();
        assert!(PublicKey::decode(&key_text).is_ok());
    }
    #[test]
    fn release_identity_and_paths_cannot_be_mixed() {
        let mut metadata = ReleaseMetadata {
            schema_version: 1,
            version: "0.4.14".into(),
            channel: "stable".into(),
            artifacts: vec![ReleaseArtifact {
                file: "setup.exe".into(),
                platform: "windows-x86_64".into(),
                sha256: "a".repeat(64),
                size_bytes: 1,
                signature: String::new(),
            }],
        };
        assert!(validate_metadata(&metadata, "0.4.14", "stable").is_ok());
        assert!(validate_metadata(&metadata, "0.4.14", "pioneer").is_err());
        assert!(validate_metadata(&metadata, "0.4.13", "stable").is_err());
        metadata.artifacts[0].file = "../outside.exe".into();
        assert!(validate_metadata(&metadata, "0.4.14", "stable").is_err());
    }
}
