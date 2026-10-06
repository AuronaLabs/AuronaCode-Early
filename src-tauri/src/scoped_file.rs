use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, File, OpenOptions};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub struct FileSnapshot {
    identity: (u64, u64),
    pub fingerprint: String,
}

pub fn snapshot(file: &File) -> Result<FileSnapshot, String> {
    use cap_fs_ext::MetadataExt;
    use std::io::{Seek, SeekFrom};
    let before = file.metadata().map_err(|e| e.to_string())?;
    let mut reader = file.try_clone().map_err(|e| e.to_string())?;
    reader.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let fingerprint = fingerprint(reader)?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    if before.dev() != after.dev()
        || before.ino() != after.ino()
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err("[file.conflict] File changed while reading its fingerprint".into());
    }
    Ok(FileSnapshot {
        identity: (after.dev(), after.ino()),
        fingerprint,
    })
}

pub fn verify_snapshot(
    directory: &Dir,
    name: &Path,
    expected: &FileSnapshot,
) -> Result<(), String> {
    let current = open(directory, name).map_err(|e| e.to_string())?;
    if snapshot(&current)? != *expected {
        return Err("[file.conflict] File identity or content changed during the operation".into());
    }
    Ok(())
}

pub fn open(directory: &Dir, name: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    directory.open_with(name, &options)
}

pub fn fingerprint(mut file: impl Read) -> Result<String, String> {
    let mut hash = Sha256::new();
    let mut bytes = 0usize;
    let mut chunk = [0; crate::resource_limits::FILE_CHUNK_BYTES];
    loop {
        let count = file.read(&mut chunk).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        bytes = bytes
            .checked_add(count)
            .ok_or("[resource.limit] Text size overflow")?;
        if bytes > crate::resource_limits::TEXT_BYTES {
            return Err("[resource.limit] Text exceeds 32 MiB".into());
        }
        hash.update(&chunk[..count]);
    }
    Ok(format!("{:x}:{bytes}", hash.finalize()))
}

pub struct StagedFile {
    pub file: File,
    directory: Dir,
    name: PathBuf,
}

impl StagedFile {
    pub fn new(directory: &Dir) -> Result<Self, String> {
        let name = PathBuf::from(format!(".aurona-save-{:032x}.tmp", rand::random::<u128>()));
        let mut options = OpenOptions::new();
        options
            .write(true)
            .read(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let file = directory
            .open_with(&name, &options)
            .map_err(|e| e.to_string())?;
        Ok(Self {
            file,
            directory: directory.try_clone().map_err(|e| e.to_string())?,
            name,
        })
    }

    pub fn commit(self, name: &Path) -> Result<(), String> {
        self.file.sync_all().map_err(|e| e.to_string())?;
        // Renaming directory entries never follows a replaced destination link.
        self.directory
            .rename(&self.name, &self.directory, name)
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        self.directory
            .try_clone()
            .and_then(|dir| dir.into_std_file().sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

impl Drop for StagedFile {
    fn drop(&mut self) {
        let _ = self.directory.remove_file(&self.name);
    }
}

pub fn write(directory: &Dir, name: &Path, contents: &[u8]) -> Result<(), String> {
    let mut stage = StagedFile::new(directory)?;
    for chunk in contents.chunks(crate::resource_limits::FILE_CHUNK_BYTES) {
        stage.file.write_all(chunk).map_err(|e| e.to_string())?;
    }
    stage.commit(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_detects_same_content_replacement_and_same_size_rewrite() {
        let root = tempfile::tempdir().unwrap();
        let dir = Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        write(&dir, Path::new("text"), b"before").unwrap();
        let source = open(&dir, Path::new("text")).unwrap();
        let before = snapshot(&source).unwrap();
        verify_snapshot(&dir, Path::new("text"), &before).unwrap();
        write(&dir, Path::new("text"), b"before").unwrap();
        assert!(verify_snapshot(&dir, Path::new("text"), &before).is_err());
        let source = open(&dir, Path::new("text")).unwrap();
        let before = snapshot(&source).unwrap();
        std::fs::write(root.path().join("text"), b"after!").unwrap();
        assert!(verify_snapshot(&dir, Path::new("text"), &before).is_err());
    }
    #[test]
    fn aborted_stage_preserves_original_and_has_no_fixed_temp_path() {
        let root = tempfile::tempdir().unwrap();
        let dir = Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        write(&dir, Path::new("text"), b"before").unwrap();
        {
            let mut stage = StagedFile::new(&dir).unwrap();
            stage.file.write_all(b"partial").unwrap();
        }
        assert_eq!(dir.read("text").unwrap(), b"before");
        assert_eq!(dir.entries().unwrap().count(), 1);
        write(&dir, Path::new("text"), b"after!").unwrap();
        assert_eq!(dir.read("text").unwrap(), b"after!");
    }
    #[cfg(unix)]
    #[test]
    fn replacement_does_not_follow_destination_symlink() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), b"protected").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret"), root.path().join("text"))
            .unwrap();
        let dir = Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        assert!(open(&dir, Path::new("text")).is_err());
        write(&dir, Path::new("text"), b"replacement").unwrap();
        assert_eq!(
            std::fs::read(outside.path().join("secret")).unwrap(),
            b"protected"
        );
    }
}
