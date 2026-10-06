use aurona_code_lib::release_verification::{verify_directory, ReleaseMetadata};
use std::{io::Read, path::Path};

fn read(path: &Path, limit: u64) -> Result<String, String> {
    let mut value = String::new();
    std::fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_string(&mut value)
        .map_err(|e| e.to_string())?;
    if value.len() as u64 > limit {
        return Err("Candidate metadata exceeds limit".into());
    }
    Ok(value)
}

fn run() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 4 {
        return Err(
            "Usage: verify_candidate <directory> <version> <stable|pioneer> <merged-tauri-config>"
                .into(),
        );
    }
    let root = Path::new(&args[0]);
    let metadata: ReleaseMetadata =
        serde_json::from_str(&read(&root.join("release-metadata.json"), 256 * 1024)?)
            .map_err(|e| e.to_string())?;
    let signature = read(&root.join("release-metadata.json.minisig"), 8192)?;
    let config =
        serde_json::from_str(&read(Path::new(&args[3]), 256 * 1024)?).map_err(|e| e.to_string())?;
    verify_directory(root, &metadata, &signature, &config, &args[1], &args[2])
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    println!("Candidate artifact hashes, Minisign signatures and release binding verified.");
}
