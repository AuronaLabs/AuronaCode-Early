use std::fs;
use std::io;
use std::path::{Path, PathBuf};
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
        reveal_on_linux(Path::new(&path))?;
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn reveal_on_linux(path: &Path) -> Result<(), String> {
    if let Ok(uri) = url::Url::from_file_path(path) {
        let show_items = format!("['{}']", uri.as_str().replace('\'', "\\'"));
        if Command::new("gdbus")
            .args([
                "call",
                "--session",
                "--dest",
                "org.freedesktop.FileManager1",
                "--object-path",
                "/org/freedesktop/FileManager1",
                "--method",
                "org.freedesktop.FileManager1.ShowItems",
                &show_items,
                "",
            ])
            .output()
            .is_ok_and(|output| output.status.success())
        {
            return Ok(());
        }
    }

    let parent = path.parent().unwrap_or(path);
    for program in ["gio", "xdg-open"] {
        let mut command = Command::new(program);
        if program == "gio" {
            command.arg("open");
        }
        match command.arg(parent).spawn() {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Unable to open the Linux file manager: {error}")),
        }
    }
    Err("No supported Linux file manager opener was found (gdbus, gio, xdg-open)".to_string())
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

fn copy_dir_all(
    workspace_root: &Path,
    src: impl AsRef<Path>,
    dst: impl AsRef<Path>,
) -> io::Result<()> {
    fs::create_dir(&dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("Refusing to copy symbolic link: {}", entry.path().display()),
            ));
        }
        let canonical_entry = entry.path().canonicalize()?;
        if !canonical_entry.starts_with(workspace_root) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("Source escapes the workspace: {}", entry.path().display()),
            ));
        }
        if ty.is_dir() {
            copy_dir_all(
                workspace_root,
                entry.path(),
                dst.as_ref().join(entry.file_name()),
            )?;
        } else {
            copy_file_new(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

fn validate_copy_or_move_paths(
    workspace_root: &str,
    source: &str,
    destination: &str,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let root = Path::new(workspace_root)
        .canonicalize()
        .map_err(|error| format!("Unable to resolve workspace root: {error}"))?;
    if !root.is_dir() {
        return Err("Workspace root is not a directory".to_string());
    }

    let source_path = Path::new(source);
    if fs::symlink_metadata(source_path)
        .map_err(|error| format!("Unable to inspect source path: {error}"))?
        .file_type()
        .is_symlink()
    {
        return Err("Symbolic links cannot be copied or moved".to_string());
    }
    let canonical_source = source_path
        .canonicalize()
        .map_err(|error| format!("Unable to resolve source path: {error}"))?;
    if canonical_source == root || !canonical_source.starts_with(&root) {
        return Err("Source path is outside the active workspace".to_string());
    }

    let destination_path = Path::new(destination);
    let destination_name = destination_path
        .file_name()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "Destination must include a file or directory name".to_string())?;
    let destination_parent = destination_path
        .parent()
        .ok_or_else(|| "Destination must have a parent directory".to_string())?
        .canonicalize()
        .map_err(|error| format!("Unable to resolve destination directory: {error}"))?;
    if !destination_parent.starts_with(&root) {
        return Err("Destination path is outside the active workspace".to_string());
    }
    let normalized_destination = destination_parent.join(destination_name);
    if normalized_destination.starts_with(&canonical_source) {
        return Err("Cannot copy or move a directory into itself".to_string());
    }

    Ok((root, canonical_source, normalized_destination))
}

#[tauri::command]
pub async fn fs_copy_or_move(
    workspace_root: String,
    source: String,
    destination: String,
    is_move: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let (root, source_path, destination_path) =
            validate_copy_or_move_paths(&workspace_root, &source, &destination)?;
        let src = source_path.as_path();
        let dst = destination_path.as_path();

        if dst.exists() {
            return Err(format!("Destination path already exists: {}", destination));
        }

        if src.is_dir() {
            if is_move {
                fs::rename(src, dst).map_err(|e| e.to_string())?;
            } else {
                copy_dir_all(&root, src, dst).map_err(|e| e.to_string())?;
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
    use super::{copy_dir_all, copy_file_new, validate_copy_or_move_paths};
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

        assert!(copy_dir_all(&root, &source, &destination).is_err());
        assert_eq!(
            fs::read_to_string(destination.join("file.txt")).expect("read destination file"),
            "destination"
        );

        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn workspace_validation_accepts_legitimate_names_containing_two_dots() {
        let root = temp_path("workspace-valid");
        let source = root.join("source..txt");
        let destination = root.join("destination..txt");
        fs::create_dir_all(&root).expect("create workspace");
        fs::write(&source, "source").expect("write source");

        let validated = validate_copy_or_move_paths(
            root.to_string_lossy().as_ref(),
            source.to_string_lossy().as_ref(),
            destination.to_string_lossy().as_ref(),
        )
        .expect("paths inside workspace should be accepted");

        assert_eq!(
            validated.1,
            source.canonicalize().expect("canonical source")
        );
        assert_eq!(
            validated.2,
            root.canonicalize()
                .expect("canonical workspace")
                .join("destination..txt")
        );
        fs::remove_dir_all(root).expect("remove temp directory");
    }

    #[test]
    fn workspace_validation_rejects_source_outside_workspace() {
        let root = temp_path("workspace-source-root");
        let outside = temp_path("workspace-source-outside");
        let source = outside.join("source.txt");
        fs::create_dir_all(&root).expect("create workspace");
        fs::create_dir_all(&outside).expect("create outside directory");
        fs::write(&source, "source").expect("write source");

        let error = validate_copy_or_move_paths(
            root.to_string_lossy().as_ref(),
            source.to_string_lossy().as_ref(),
            root.join("destination.txt").to_string_lossy().as_ref(),
        )
        .expect_err("outside source should be rejected");

        assert!(error.contains("outside the active workspace"));
        fs::remove_dir_all(root).expect("remove workspace");
        fs::remove_dir_all(outside).expect("remove outside directory");
    }

    #[test]
    fn workspace_validation_rejects_destination_outside_workspace() {
        let root = temp_path("workspace-destination-root");
        let outside = temp_path("workspace-destination-outside");
        let source = root.join("source.txt");
        fs::create_dir_all(&root).expect("create workspace");
        fs::create_dir_all(&outside).expect("create outside directory");
        fs::write(&source, "source").expect("write source");

        let error = validate_copy_or_move_paths(
            root.to_string_lossy().as_ref(),
            source.to_string_lossy().as_ref(),
            outside.join("destination.txt").to_string_lossy().as_ref(),
        )
        .expect_err("outside destination should be rejected");

        assert!(error.contains("outside the active workspace"));
        fs::remove_dir_all(root).expect("remove workspace");
        fs::remove_dir_all(outside).expect("remove outside directory");
    }

    #[test]
    fn workspace_validation_rejects_copying_directory_into_itself() {
        let root = temp_path("workspace-recursive-copy");
        let source = root.join("source");
        fs::create_dir_all(&source).expect("create source directory");

        let error = validate_copy_or_move_paths(
            root.to_string_lossy().as_ref(),
            source.to_string_lossy().as_ref(),
            source.join("nested-copy").to_string_lossy().as_ref(),
        )
        .expect_err("recursive copy should be rejected");

        assert!(error.contains("into itself"));
        fs::remove_dir_all(root).expect("remove workspace");
    }
}
