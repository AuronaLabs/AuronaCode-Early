use std::fs;
use std::io;
use std::path::Path;
use std::process::Command;

#[tauri::command]
pub fn reveal_in_os(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = Path::new(&path).parent().unwrap_or(Path::new(&path));
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn copy_file_new(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> io::Result<()> {
    let mut source = fs::File::open(src)?;
    let mut destination = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dst)?;
    io::copy(&mut source, &mut destination)?;
    Ok(())
}

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> io::Result<()> {
    fs::create_dir(&dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            copy_file_new(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_copy_or_move(
    source: String,
    destination: String,
    is_move: bool,
) -> Result<(), String> {
    if source.contains("..") || destination.contains("..") {
        return Err("Path traversal detected".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let src = Path::new(&source);
        let dst = Path::new(&destination);

        if !src.exists() {
            return Err(format!("Source path does not exist: {}", source));
        }
        if dst.exists() {
            return Err(format!("Destination path already exists: {}", destination));
        }

        if src.is_dir() {
            if is_move {
                fs::rename(src, dst).map_err(|e| e.to_string())?;
            } else {
                copy_dir_all(src, dst).map_err(|e| e.to_string())?;
            }
        } else {
            if is_move {
                fs::rename(src, dst).map_err(|e| e.to_string())?;
            } else {
                copy_file_new(src, dst).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{copy_dir_all, copy_file_new};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "aurona-code-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn copy_file_new_rejects_existing_destination_without_overwriting_it() {
        let root = temp_path("copy-file");
        fs::create_dir_all(&root).expect("create temp directory");
        let source = root.join("source.txt");
        let destination = root.join("destination.txt");
        fs::write(&source, "source").expect("write source");
        fs::write(&destination, "destination").expect("write destination");

        assert!(copy_file_new(&source, &destination).is_err());
        assert_eq!(
            fs::read_to_string(&destination).expect("read destination"),
            "destination"
        );

        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn copy_dir_all_rejects_existing_destination_directory() {
        let root = temp_path("copy-directory");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).expect("create source directory");
        fs::write(source.join("file.txt"), "source").expect("write source file");
        fs::create_dir_all(&destination).expect("create destination directory");
        fs::write(destination.join("file.txt"), "destination").expect("write destination file");

        assert!(copy_dir_all(&source, &destination).is_err());
        assert_eq!(
            fs::read_to_string(destination.join("file.txt")).expect("read destination file"),
            "destination"
        );

        fs::remove_dir_all(root).expect("remove temp directory");
    }
}
