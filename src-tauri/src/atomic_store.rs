use std::io::Write;
use std::path::Path;

/// Replace application metadata without creating a backup of secret-bearing input.
pub fn replace(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("[storage.path] Missing parent directory")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut stage = tempfile::Builder::new()
        .prefix(".aurona-")
        .tempfile_in(parent)
        .map_err(|error| error.to_string())?;
    stage
        .write_all(contents)
        .map_err(|error| error.to_string())?;
    stage
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    stage
        .persist(path)
        .map_err(|error| error.error.to_string())?;
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn replaces_existing_file_without_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        super::replace(&path, b"old-secret").unwrap();
        super::replace(&path, b"sanitized").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"sanitized");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
