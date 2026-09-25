use base64::{engine::general_purpose::STANDARD, Engine as _};
use notify::Watcher;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};

#[tauri::command]
pub fn reveal_in_os(state: State<WorkspaceState>, path: String) -> Result<(), String> {
    if !state.is_path_authorized(&path)? {
        return Err(workspace_error(
            "路径不在授权范围内，无法在文件管理器中显示",
        ));
    }
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

/// Backend-owned workspace authorization session. The frontend may open or
/// close a workspace, but every workspace file operation is resolved and
/// validated against this canonical root by Rust. Arbitrary frontend input can
/// never redefine the trusted root on a per-call basis.
pub struct WorkspaceState {
    root: Mutex<Option<PathBuf>>,
    watchers: Mutex<HashMap<String, notify::RecommendedWatcher>>,
    authorized: Mutex<HashSet<PathBuf>>,
}

impl WorkspaceState {
    pub fn new() -> Self {
        Self {
            root: Mutex::new(None),
            watchers: Mutex::new(HashMap::new()),
            authorized: Mutex::new(HashSet::new()),
        }
    }

    /// Canonicalized workspace root, if a workspace is open.
    pub fn root(&self) -> Result<Option<PathBuf>, String> {
        self.root
            .lock()
            .map_err(|_| workspace_error("Workspace state lock is poisoned"))
            .map(|guard| guard.clone())
    }

    /// Whether `path` canonicalizes inside the active workspace root.
    pub fn contains(&self, path: &str) -> Result<bool, String> {
        let root = self.root()?;
        let canonical = Path::new(path)
            .canonicalize()
            .map_err(|error| format!("无法解析路径 {path}: {error}"))?;
        Ok(root
            .as_ref()
            .is_some_and(|root| canonical.starts_with(root)))
    }

    /// Whether `path` is inside the workspace root or was explicitly authorized
    /// through a system file dialog.
    pub fn is_path_authorized(&self, path: &str) -> Result<bool, String> {
        if self.contains(path)? {
            return Ok(true);
        }
        let canonical = Path::new(path)
            .canonicalize()
            .map_err(|error| format!("无法解析路径 {path}: {error}"))?;
        Ok(self
            .authorized
            .lock()
            .map_err(|_| workspace_error("Workspace authorization lock is poisoned"))?
            .contains(&canonical))
    }

    /// Records a dialog-confirmed path so the editor may open it even when it
    /// lives outside the workspace root.
    pub fn authorize_path(&self, path: &str) -> Result<(), String> {
        let canonical = Path::new(path)
            .canonicalize()
            .map_err(|error| format!("无法解析路径 {path}: {error}"))?;
        self.authorized
            .lock()
            .map_err(|_| workspace_error("Workspace authorization lock is poisoned"))?
            .insert(canonical);
        Ok(())
    }
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub is_directory: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceWatchEvent {
    id: String,
    kind: String,
    paths: Vec<String>,
}

fn workspace_error(message: impl Into<String>) -> String {
    message.into()
}

fn current_root(state: &WorkspaceState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| workspace_error("Workspace state lock is poisoned"))?
        .clone()
        .ok_or_else(|| workspace_error("尚未打开工作区"))
}

/// Resolves `path` against the canonical workspace root and rejects anything
/// that canonicalizes outside it. Symbolic links are rejected for existing
/// targets so they cannot silently expand the accessible boundary.
fn resolve_workspace_path(
    root: &Path,
    path: &str,
    require_existing: bool,
) -> Result<PathBuf, String> {
    let requested = Path::new(path);
    let resolved = if require_existing || requested.exists() {
        // Reject symbolic links before canonicalization so a link cannot
        // silently redirect the operation outside the workspace.
        if fs::symlink_metadata(requested).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err(workspace_error(format!("不允许操作符号链接: {path}")));
        }
        requested
            .canonicalize()
            .map_err(|error| format!("无法解析路径 {}: {error}", requested.display()))?
    } else {
        // The target does not exist yet (create/write/rename destination).
        // Walk up to the deepest existing ancestor, canonicalize it, then
        // re-append the remaining segments so recursive creation works even
        // when intermediate directories do not exist yet.
        let mut missing_tail: Vec<std::ffi::OsString> = Vec::new();
        let mut cursor = requested;
        loop {
            if let Ok(canonical) = cursor.canonicalize() {
                let mut resolved = canonical;
                for segment in missing_tail.into_iter().rev() {
                    resolved.push(segment);
                }
                break resolved;
            }
            match (cursor.parent(), cursor.file_name()) {
                (Some(parent), Some(name)) => {
                    missing_tail.push(name.to_os_string());
                    cursor = parent;
                }
                _ => {
                    return Err(workspace_error(format!(
                        "路径缺少可解析的父目录: {}",
                        requested.display()
                    )));
                }
            }
        }
    };

    if !resolved.starts_with(root) {
        return Err(workspace_error(format!("路径位于活动工作区之外: {path}")));
    }

    if require_existing {
        let metadata = fs::symlink_metadata(&resolved)
            .map_err(|error| format!("无法访问 {}: {error}", resolved.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(workspace_error(format!("不允许操作符号链接: {path}")));
        }
    }
    Ok(resolved)
}

#[tauri::command]
pub fn workspace_set_root(
    state: State<WorkspaceState>,
    root: Option<String>,
) -> Result<(), String> {
    {
        let mut guard = state
            .root
            .lock()
            .map_err(|_| workspace_error("Workspace state lock is poisoned"))?;
        match root {
            Some(raw) => {
                let requested = PathBuf::from(raw);
                let canonical = requested.canonicalize().map_err(|error| {
                    format!("无法解析工作区根目录 {}: {error}", requested.display())
                })?;
                if !canonical.is_dir() {
                    return Err(workspace_error("工作区根目录不是文件夹"));
                }
                *guard = Some(canonical);
            }
            None => {
                *guard = None;
            }
        }
    }

    // Opening or closing a workspace redefines the authorized path set: the
    // root itself is always authorized, everything else must be re-confirmed.
    {
        let mut authorized = state
            .authorized
            .lock()
            .map_err(|_| workspace_error("Workspace authorization lock is poisoned"))?;
        authorized.clear();
        if let Ok(Some(root)) = state.root() {
            authorized.insert(root);
        }
    }

    // A workspace change invalidates watchers rooted in the previous session.
    state
        .watchers
        .lock()
        .map_err(|_| workspace_error("Watcher state lock is poisoned"))?
        .clear();
    Ok(())
}

#[tauri::command]
pub async fn fs_read_dir(app: tauri::AppHandle, path: String) -> Result<Vec<FsEntry>, String> {
    let state = app.state::<WorkspaceState>();
    let root = current_root(&state)?;
    let directory = resolve_workspace_path(&root, &path, true)?;
    if !directory.is_dir() {
        return Err(workspace_error(format!("不是文件夹: {path}")));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut entries = Vec::new();
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("无法读取 {}: {error}", directory.display()))?
        {
            let entry = entry.map_err(|error| format!("无法读取目录项: {error}"))?;
            let file_type = entry
                .file_type()
                .map_err(|error| format!("无法检查 {}: {error}", entry.path().display()))?;
            if file_type.is_symlink() {
                continue;
            }
            entries.push(FsEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                is_directory: file_type.is_dir(),
            });
        }
        Ok(entries)
    })
    .await
    .map_err(|error| workspace_error(format!("读取目录任务失败: {error}")))?
}

#[tauri::command]
pub async fn fs_exists(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    let state = app.state::<WorkspaceState>();
    let root = current_root(&state)?;
    let resolved = resolve_workspace_path(&root, &path, false)?;
    tauri::async_runtime::spawn_blocking(move || Ok(resolved.exists()))
        .await
        .map_err(|error| workspace_error(format!("文件检查任务失败: {error}")))?
}

#[tauri::command]
pub async fn fs_read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let state = app.state::<WorkspaceState>();
    let root = current_root(&state)?;
    let resolved = resolve_workspace_path(&root, &path, true)?;
    if !resolved.is_file() {
        return Err(workspace_error(format!("不是文件: {path}")));
    }
    tauri::async_runtime::spawn_blocking(move || {
        fs::read_to_string(&resolved)
            .map_err(|error| format!("无法读取 {}: {error}", resolved.display()))
    })
    .await
    .map_err(|error| workspace_error(format!("读取文件任务失败: {error}")))?
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

#[tauri::command]
pub async fn fs_read_image_data_url(app: tauri::AppHandle, path: String) -> Result<String, String> {
    const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;
    let state = app.state::<WorkspaceState>();
    let root = current_root(&state)?;
    let resolved = resolve_workspace_path(&root, &path, true)?;
    tauri::async_runtime::spawn_blocking(move || {
        let file = fs::File::open(&resolved).map_err(|error| error.to_string())?;
        if !file
            .metadata()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            return Err("Image path is not a file".to_string());
        }
        let mut bytes = Vec::new();
        file.take(MAX_IMAGE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_IMAGE_BYTES {
            return Err("Image exceeds the 8 MiB preview limit".to_string());
        }
        let mime = image_mime(&bytes).ok_or_else(|| "Unsupported image format".to_string())?;
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn fs_write_text_file(
    app: tauri::AppHandle,
    path: String,
    contents: String,
) -> Result<(), String> {
    let state = app.state::<WorkspaceState>();
    let root = current_root(&state)?;
    let resolved = resolve_workspace_path(&root, &path, false)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::write(&resolved, contents)
            .map_err(|error| format!("无法写入 {}: {error}", resolved.display()))
    })
    .await
    .map_err(|error| workspace_error(format!("写入文件任务失败: {error}")))?
}

#[tauri::command]
pub async fn fs_mkdir(app: tauri::AppHandle, path: String, recursive: bool) -> Result<(), String> {
    let state = app.state::<WorkspaceState>();
    let root = current_root(&state)?;
    let resolved = resolve_workspace_path(&root, &path, false)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = if recursive {
            fs::create_dir_all(&resolved)
        } else {
            fs::create_dir(&resolved)
        };
        result.map_err(|error| format!("无法创建文件夹 {}: {error}", resolved.display()))
    })
    .await
    .map_err(|error| workspace_error(format!("创建文件夹任务失败: {error}")))?
}

#[tauri::command]
pub async fn fs_remove(app: tauri::AppHandle, path: String, recursive: bool) -> Result<(), String> {
    let state = app.state::<WorkspaceState>();
    let root = current_root(&state)?;
    let resolved = resolve_workspace_path(&root, &path, true)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = if resolved.is_dir() {
            if recursive {
                fs::remove_dir_all(&resolved)
            } else {
                fs::remove_dir(&resolved)
            }
        } else {
            fs::remove_file(&resolved)
        };
        result.map_err(|error| format!("无法删除 {}: {error}", resolved.display()))
    })
    .await
    .map_err(|error| workspace_error(format!("删除任务失败: {error}")))?
}

#[tauri::command]
pub async fn fs_rename(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    let state = app.state::<WorkspaceState>();
    let root = current_root(&state)?;
    let source = resolve_workspace_path(&root, &from, true)?;
    let destination = resolve_workspace_path(&root, &to, false)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::rename(&source, &destination).map_err(|error| {
            format!(
                "无法重命名 {} 到 {}: {error}",
                source.display(),
                destination.display()
            )
        })
    })
    .await
    .map_err(|error| workspace_error(format!("重命名任务失败: {error}")))?
}

/// Saves a file whose path was chosen by the user through the native save
/// dialog. The dialog runs inside Rust so the frontend never supplies an
/// arbitrary write target; this is the only non-workspace write surface.
#[tauri::command]
pub async fn fs_export_dialog_file(
    app: tauri::AppHandle,
    contents: String,
    default_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("JSON", &["json"])
            .set_file_name(&default_name)
            .blocking_save_file()
    })
    .await
    .map_err(|error| workspace_error(format!("保存对话框任务失败: {error}")))?;

    let Some(picked) = picked else {
        return Ok(None);
    };
    let target = match picked {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        tauri_plugin_dialog::FilePath::Url(_) => {
            return Err(workspace_error("保存对话框返回了不支持的 URL"));
        }
    };
    let saved = tauri::async_runtime::spawn_blocking(move || {
        fs::write(&target, contents)
            .map_err(|error| format!("无法写入 {}: {error}", target.display()))?;
        Ok::<String, String>(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| workspace_error(format!("写入导出文件任务失败: {error}")))??;
    Ok(Some(saved))
}

#[tauri::command]
pub fn fs_watch_start(
    app: tauri::AppHandle,
    state: State<WorkspaceState>,
    path: String,
    recursive: bool,
) -> Result<String, String> {
    let root = current_root(&state)?;
    let target = resolve_workspace_path(&root, &path, true)?;
    if !target.is_dir() {
        return Err(workspace_error(format!("只能监听文件夹: {path}")));
    }

    let mode = if recursive {
        notify::RecursiveMode::Recursive
    } else {
        notify::RecursiveMode::NonRecursive
    };
    let (sender, receiver) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let _ = sender.send(event);
    })
    .map_err(|error| workspace_error(format!("无法创建文件监听器: {error}")))?;
    watcher
        .watch(&target, mode)
        .map_err(|error| workspace_error(format!("无法监听 {}: {error}", target.display())))?;

    let id = format!(
        "watch-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0)
    );
    state
        .watchers
        .lock()
        .map_err(|_| workspace_error("Watcher state lock is poisoned"))?
        .insert(id.clone(), watcher);

    let event_app = app.clone();
    let event_id = id.clone();
    std::thread::spawn(move || {
        let mut pending: Vec<String> = Vec::new();
        loop {
            match receiver.recv_timeout(Duration::from_millis(300)) {
                Ok(Ok(event)) => {
                    for changed in event.paths {
                        pending.push(changed.to_string_lossy().into_owned());
                    }
                }
                Ok(Err(_)) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() {
                        let payload = WorkspaceWatchEvent {
                            id: event_id.clone(),
                            kind: "any".to_string(),
                            paths: std::mem::take(&mut pending),
                        };
                        let _ = event_app.emit("fs:changed", payload);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn fs_watch_stop(state: State<WorkspaceState>, id: String) -> Result<(), String> {
    state
        .watchers
        .lock()
        .map_err(|_| workspace_error("Watcher state lock is poisoned"))?
        .remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        copy_dir_all, copy_file_new, current_root, resolve_workspace_path,
        validate_copy_or_move_paths, WorkspaceState,
    };
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

    #[test]
    fn workspace_session_rejects_paths_outside_the_authorized_root() {
        let root = temp_path("session-root");
        let outside = temp_path("session-outside");
        fs::create_dir_all(&root).expect("create workspace");
        fs::create_dir_all(&outside).expect("create outside directory");
        fs::write(root.join("inside.txt"), "inside").expect("write inside file");
        fs::write(outside.join("outside.txt"), "outside").expect("write outside file");

        let state = WorkspaceState::new();
        let authorized = root.canonicalize().expect("workspace should canonicalize");
        *state.root.lock().expect("lock workspace root") = Some(authorized.clone());

        assert_eq!(current_root(&state).expect("root is set"), authorized);
        assert!(resolve_workspace_path(
            &authorized,
            root.join("inside.txt").to_str().unwrap(),
            true
        )
        .is_ok());
        let error = resolve_workspace_path(
            &authorized,
            outside.join("outside.txt").to_str().unwrap(),
            true,
        )
        .expect_err("outside path must be rejected");
        assert!(error.contains("活动工作区之外"));

        fs::remove_dir_all(root).expect("remove workspace");
        fs::remove_dir_all(outside).expect("remove outside directory");
    }

    #[test]
    fn workspace_session_accepts_not_yet_existing_targets_inside_the_root() {
        let root = temp_path("session-create");
        fs::create_dir_all(&root).expect("create workspace");
        let authorized = root.canonicalize().expect("workspace should canonicalize");

        let target = authorized.join("nested").join("new-file.txt");
        let resolved = resolve_workspace_path(&authorized, target.to_str().unwrap(), false)
            .expect("new target inside workspace should resolve");
        assert!(resolved.starts_with(&authorized));

        let error = resolve_workspace_path(
            &authorized,
            authorized
                .parent()
                .expect("temp dir has a parent")
                .join("outside-new.txt")
                .to_str()
                .unwrap(),
            false,
        )
        .expect_err("new target outside workspace must be rejected");
        assert!(error.contains("活动工作区之外"));

        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn workspace_authorization_covers_root_and_dialog_confirmed_paths() {
        let root = temp_path("auth-root");
        let outside = temp_path("auth-outside");
        fs::create_dir_all(&root).expect("create workspace");
        fs::create_dir_all(&outside).expect("create outside directory");
        let inside_file = root.join("inside.txt");
        let outside_file = outside.join("outside.txt");
        fs::write(&inside_file, "in").expect("write inside file");
        fs::write(&outside_file, "out").expect("write outside file");

        let state = WorkspaceState::new();
        *state.root.lock().expect("lock workspace root") =
            Some(root.canonicalize().expect("workspace should canonicalize"));

        assert!(state
            .contains(inside_file.to_str().unwrap())
            .expect("inside path resolves"));
        assert!(!state
            .contains(outside_file.to_str().unwrap())
            .expect("outside path resolves"));
        assert!(state
            .is_path_authorized(inside_file.to_str().unwrap())
            .expect("inside file is authorized"));
        assert!(!state
            .is_path_authorized(outside_file.to_str().unwrap())
            .expect("outside file is not authorized"));

        state
            .authorize_path(outside_file.to_str().unwrap())
            .expect("dialog-confirmed path should authorize");
        assert!(state
            .is_path_authorized(outside_file.to_str().unwrap())
            .expect("dialog-confirmed file becomes authorized"));

        fs::remove_dir_all(root).expect("remove workspace");
        fs::remove_dir_all(outside).expect("remove outside directory");
    }
}
