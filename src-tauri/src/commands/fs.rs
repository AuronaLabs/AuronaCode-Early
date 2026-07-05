use std::process::Command;
use std::path::Path;
use std::fs;

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

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    fs::create_dir_all(&dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_copy_or_move(source: String, destination: String, is_move: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let src = Path::new(&source);
        let dst = Path::new(&destination);
        
        if !src.exists() {
            return Err(format!("Source path does not exist: {}", source));
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
                fs::copy(src, dst).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    }).await.map_err(|e| e.to_string())?
}
