//! Bounded capability-based tree hashing for writes and recovery.
use super::*;

pub(super) fn tree_digest(
    directory: &cap_std::fs::Dir,
    name: &Path,
) -> Result<(String, usize, u64), String> {
    use sha2::{Digest, Sha256};
    fn visit(
        directory: &cap_std::fs::Dir,
        name: &Path,
        hash: &mut Sha256,
        entries: &mut usize,
        bytes: &mut u64,
        depth: usize,
    ) -> Result<(), String> {
        *entries += 1;
        if *entries > 100_000 || depth > 128 {
            return Err("[resource.limit] Recovery tree exceeds entry or depth limit".into());
        }
        let metadata = directory
            .symlink_metadata(name)
            .map_err(|e| e.to_string())?;
        if depth > 0 {
            hash.update(name.to_string_lossy().as_bytes());
        }
        if metadata.file_type().is_symlink() {
            return Err("[workspace.link] Recovery tree contains a link".into());
        }
        if metadata.is_dir() {
            hash.update(b"directory");
            let child = directory
                .open_dir_nofollow(name)
                .map_err(|e| e.to_string())?;
            let mut names = Vec::new();
            for entry in child.entries().map_err(|e| e.to_string())? {
                if names.len() + *entries >= 100_000 {
                    return Err("[resource.limit] Recovery directory exceeds entry limit".into());
                }
                names.push(PathBuf::from(entry.map_err(|e| e.to_string())?.file_name()));
            }
            names.sort();
            for name in names {
                visit(&child, &name, hash, entries, bytes, depth + 1)?;
            }
        } else if metadata.is_file() {
            hash.update(b"file");
            let mut options = cap_std::fs::OpenOptions::new();
            options.read(true).follow(FollowSymlinks::No);
            let mut file = directory
                .open_with(name, &options)
                .map_err(|e| e.to_string())?;
            let mut buffer = [0u8; 65536];
            loop {
                let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if count == 0 {
                    break;
                }
                *bytes += count as u64;
                if *bytes > 256 * 1024 * 1024 {
                    return Err("[resource.limit] Delete recovery exceeds 256 MiB; operation was not performed".into());
                }
                hash.update(&buffer[..count]);
            }
        } else {
            return Err("[workspace.file_type] Recovery tree contains a special file".into());
        }
        Ok(())
    }
    let mut hash = Sha256::new();
    let mut entries = 0;
    let mut bytes = 0;
    visit(directory, name, &mut hash, &mut entries, &mut bytes, 0)?;
    Ok((format!("{:x}", hash.finalize()), entries, bytes))
}
