use aurona_code_lib::release_verification::{validate_metadata, ReleaseArtifact, ReleaseMetadata};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};

fn run() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 5 {
        return Err("Usage: prepare_candidate <directory> <version> <stable|pioneer> <platform> <artifact-file>".into());
    }
    let root = Path::new(&args[0]);
    let path = root.join(&args[4]);
    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut chunk = [0u8; 256 * 1024];
    loop {
        let count = file.read(&mut chunk).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > 2 * 1024 * 1024 * 1024 {
            return Err("Candidate artifact exceeds 2 GiB".into());
        }
        hash.update(&chunk[..count]);
    }
    let signature_path = root.join(format!("{}.sig", args[4]));
    let signature = if signature_path.exists() {
        let text = std::fs::read_to_string(signature_path).map_err(|e| e.to_string())?;
        if text.len() > 16384 {
            return Err("Artifact signature exceeds limit".into());
        }
        if text.starts_with("untrusted comment:") {
            text
        } else {
            String::from_utf8(
                STANDARD
                    .decode(text.trim())
                    .map_err(|_| "Invalid encoded artifact signature")?,
            )
            .map_err(|_| "Invalid artifact signature text")?
        }
    } else {
        String::new()
    };
    let digest = format!("{:x}", hash.finalize());
    let metadata = ReleaseMetadata {
        schema_version: 1,
        version: args[1].clone(),
        channel: args[2].clone(),
        artifacts: args[3]
            .split(',')
            .map(|platform| ReleaseArtifact {
                file: args[4].clone(),
                platform: platform.into(),
                sha256: digest.clone(),
                size_bytes: size,
                signature: signature.clone(),
            })
            .collect(),
    };
    validate_metadata(&metadata, &args[1], &args[2])?;
    let canonical = serde_jcs::to_vec(&metadata).map_err(|e| e.to_string())?;
    std::fs::write(root.join("release-metadata.json"), canonical).map_err(|e| e.to_string())?;
    std::fs::write(
        root.join("SHA256SUMS"),
        format!("{}  {}\n", metadata.artifacts[0].sha256, args[4]),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    println!("Candidate canonical metadata and SHA-256 generated; signature validation is a separate step.");
}
