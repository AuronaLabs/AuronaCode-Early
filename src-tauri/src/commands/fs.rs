use base64::{engine::general_purpose::STANDARD, Engine as _};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use notify::Watcher;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
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

#[cfg(test)]
fn copy_file_new(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> io::Result<()> {
    let mut source = fs::File::open(src)?;
    let mut destination = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dst)?;
    io::copy(&mut source, &mut destination)?;
    Ok(())
}

#[cfg(test)]
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

#[cfg(test)]
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
    app: tauri::AppHandle,
    source: String,
    destination: String,
    is_move: bool,
) -> Result<(), String> {
    let state = app.state::<WorkspaceState>();
    let generation = state.generation();
    let (source_dir, source_name) = state.write_access(&source)?;
    let (target_dir, target_name) = state.write_access(&destination)?;
    let root = current_root(&state)?;
    let src = Path::new(&source)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let dst_parent = Path::new(&destination)
        .parent()
        .ok_or("Missing destination parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    reject_root_mutation(&root, &src)?;
    if dst_parent.starts_with(&src) {
        return Err("Cannot copy or move a directory into itself".into());
    }
    tokio::task::spawn_blocking(move || {
        let state = app.state::<WorkspaceState>();
        let _guard = state.root.lock().map_err(|e| e.to_string())?;
        if state.generation() != generation {
            return Err("[workspace.generation] Workspace changed".into());
        }
        if target_dir.symlink_metadata(&target_name).is_ok() {
            return Err("Destination path already exists".into());
        }
        if is_move {
            source_dir
                .rename(&source_name, &target_dir, &target_name)
                .map_err(|e| e.to_string())?;
        } else {
            let mut entries = 0usize;
            copy_scoped(
                &source_dir,
                &source_name,
                &target_dir,
                &target_name,
                0,
                &mut entries,
            )?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn copy_scoped(
    source: &cap_std::fs::Dir,
    name: &Path,
    target: &cap_std::fs::Dir,
    destination: &Path,
    depth: usize,
    entries: &mut usize,
) -> Result<(), String> {
    *entries += 1;
    if depth > 128 || *entries > crate::resource_limits::ARCHIVE_ENTRIES {
        return Err("[resource.limit] Copy tree exceeds entry or depth limit".into());
    }
    let metadata = source.symlink_metadata(name).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("[workspace.link] Links cannot be copied".into());
    }
    if metadata.is_dir() {
        let source = source.open_dir_nofollow(name).map_err(|e| e.to_string())?;
        target.create_dir(destination).map_err(|e| e.to_string())?;
        let target = target
            .open_dir_nofollow(destination)
            .map_err(|e| e.to_string())?;
        for entry in source.entries().map_err(|e| e.to_string())? {
            let name = PathBuf::from(entry.map_err(|e| e.to_string())?.file_name());
            copy_scoped(&source, &name, &target, &name, depth + 1, entries)?;
        }
    } else if metadata.is_file() {
        let mut options = cap_std::fs::OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let mut input = source
            .open_with(name, &options)
            .map_err(|e| e.to_string())?;
        let mut output = target
            .open_with(
                destination,
                cap_std::fs::OpenOptions::new().write(true).create_new(true),
            )
            .map_err(|e| e.to_string())?;
        io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
    } else {
        return Err("[workspace.file_type] Unsupported file type".into());
    }
    Ok(())
}

fn tree_digest(directory: &cap_std::fs::Dir, name: &Path) -> Result<(String, usize, u64), String> {
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

/// Backend-owned workspace authorization session. The frontend may open or
/// close a workspace, but every workspace file operation is resolved and
/// validated against this canonical root by Rust. Arbitrary frontend input can
/// never redefine the trusted root on a per-call basis.
pub struct WorkspaceState {
    transition: tokio::sync::Mutex<()>,
    root: Mutex<Option<PathBuf>>,
    watchers: Mutex<HashMap<String, WorkspaceWatcher>>,
    authorized: Mutex<HashSet<PathBuf>>,
    authorized_files: Mutex<HashMap<PathBuf, (cap_std::fs::Dir, PathBuf)>>,
    directory: Mutex<Option<cap_std::fs::Dir>>,
    generation: AtomicU64,
    directory_revision: AtomicU64,
    cursors: Mutex<HashMap<String, DirectoryCursor>>,
}

struct WorkspaceWatcher {
    _watcher: notify::RecommendedWatcher,
    _lease: crate::resource_limits::WatchLease,
    stopped: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl Drop for WorkspaceWatcher {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
    }
}

impl WorkspaceState {
    pub(crate) fn directory_handle(&self, path: &str) -> Result<cap_std::fs::Dir, String> {
        let (directory, name) = self.access(path, true)?;
        directory.open_dir_nofollow(name).map_err(|e| e.to_string())
    }

    pub fn write_access(&self, path: &str) -> Result<(cap_std::fs::Dir, PathBuf), String> {
        let (directory, name) = self.access(path, false)?;
        if name == Path::new(".") {
            return Err("[workspace.root_protected] Cannot replace the workspace root".into());
        }
        let root = self
            .root()?
            .ok_or("[workspace.closed] No active workspace")?;
        let requested = PathBuf::from(path);
        #[cfg(windows)]
        let requested = windows_long_path(&requested);
        if workspace_relative_path(&root, &requested)?
            .components()
            .any(|part| {
                part.as_os_str()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(".aurona-recovery")
            })
        {
            return Err("[workspace.recovery_protected] Recovery data is protected".into());
        }
        Ok((directory, name))
    }
    pub fn file_access(&self, path: &str) -> Result<(cap_std::fs::Dir, PathBuf), String> {
        if self
            .root()?
            .is_some_and(|root| workspace_relative_path(&root, Path::new(path)).is_ok())
        {
            return self.access(path, true);
        }
        let key = lexical_path(Path::new(path));
        let authorized = self.authorized_files.lock().map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let key =
            if authorized.contains_key(&key) {
                key
            } else {
                if !key.is_absolute()
                    || !authorized
                        .keys()
                        .any(|approved| windows_same_prefix(approved, &key))
                    || key
                        .components()
                        .any(|part| matches!(part, std::path::Component::ParentDir))
                {
                    return Err(
                        "[workspace.authorization] File has not been selected by the user".into(),
                    );
                }
                lexical_path(&key.canonicalize().map_err(|_| {
                    "[workspace.authorization] File has not been selected by the user"
                })?)
            };
        let (directory, name) = authorized
            .get(&key)
            .ok_or("[workspace.authorization] File has not been selected by the user")?;
        crate::scoped_file::open(directory, name).map_err(|e| e.to_string())?;
        Ok((
            directory.try_clone().map_err(|e| e.to_string())?,
            name.clone(),
        ))
    }

    pub fn with_generation<T>(
        &self,
        generation: u64,
        work: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let _guard = self.root.lock().map_err(|e| e.to_string())?;
        if self.generation() != generation {
            return Err("[workspace.generation] Workspace changed".into());
        }
        work()
    }

    pub(crate) fn exists(&self, path: &str) -> Result<bool, String> {
        let root = self
            .root()?
            .ok_or("[workspace.closed] No active workspace")?;
        let relative = workspace_relative_path(&root, Path::new(path))?;
        if relative
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return Err("[workspace.boundary] Invalid relative path".into());
        }
        let mut dir = self
            .directory
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .ok_or("[workspace.closed] No directory")?
            .try_clone()
            .map_err(|e| e.to_string())?;
        let components = relative.components().collect::<Vec<_>>();
        for (index, component) in components.iter().enumerate() {
            match dir.symlink_metadata(component.as_os_str()) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err("[workspace.link] Symbolic links are prohibited".into())
                }
                Ok(_) if index + 1 == components.len() => return Ok(true),
                Ok(_) => {
                    dir = dir
                        .open_dir_nofollow(component.as_os_str())
                        .map_err(|e| e.to_string())?
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
                Err(error) => return Err(error.to_string()),
            }
        }
        Ok(true)
    }
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    pub fn validate_path(&self, path: &str, existing: bool) -> Result<(), String> {
        self.access(path, existing).map(|_| ())
    }

    pub fn content_digest(&self, path: &str) -> Result<String, String> {
        let (directory, name) = self.access(path, true)?;
        tree_digest(&directory, &name).map(|(hash, _, _)| hash)
    }

    pub fn require_directory(&self, path: &str) -> Result<PathBuf, String> {
        if !self.is_path_authorized(path)? {
            return Err("[workspace.boundary] Not an authorized directory".into());
        }
        let resolved = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
        if self
            .root()?
            .is_some_and(|root| workspace_relative_path(&root, Path::new(path)).is_ok())
        {
            let (parent, name) = self.access(path, true)?;
            parent
                .open_dir_nofollow(name)
                .map_err(|_| "[workspace.link] Directory is a link or unavailable")?;
        }
        if !resolved.is_dir() {
            return Err("[workspace.boundary] Not an authorized directory".into());
        }
        Ok(resolved)
    }

    fn access(&self, path: &str, existing: bool) -> Result<(cap_std::fs::Dir, PathBuf), String> {
        let root_guard = self.root.lock().map_err(|e| e.to_string())?;
        let root = root_guard
            .as_ref()
            .ok_or("[workspace.closed] No active workspace")?;
        let relative = workspace_relative_path(root, Path::new(path))?;
        if relative
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
        {
            return Err("[workspace.boundary] Invalid relative path".into());
        }
        let mut dir = self
            .directory
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .ok_or_else(|| "Workspace directory is unavailable".to_string())?
            .try_clone()
            .map_err(|e| e.to_string())?;
        let Some(name) = relative.file_name() else {
            return Ok((dir, PathBuf::from(".")));
        };
        if let Some(parent) = relative.parent() {
            for component in parent.components() {
                dir = dir
                    .open_dir_nofollow(component.as_os_str())
                    .map_err(|_| "[workspace.link] Directory is unavailable or is a link")?;
            }
        }
        let name = PathBuf::from(name);
        match dir.symlink_metadata(&name) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("[workspace.link] Symbolic links are prohibited".into())
            }
            Err(error) if existing || error.kind() != io::ErrorKind::NotFound => {
                return Err(error.to_string())
            }
            _ => {}
        }
        Ok((dir, name))
    }

    pub fn new() -> Self {
        Self {
            transition: tokio::sync::Mutex::new(()),
            root: Mutex::new(None),
            watchers: Mutex::new(HashMap::new()),
            authorized: Mutex::new(HashSet::new()),
            authorized_files: Mutex::new(HashMap::new()),
            directory: Mutex::new(None),
            generation: AtomicU64::new(0),
            directory_revision: AtomicU64::new(0),
            cursors: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub(crate) fn test_root(root: &Path) -> Self {
        let state = Self::new();
        let root = root.canonicalize().unwrap();
        *state.directory.lock().unwrap() =
            Some(cap_std::fs::Dir::open_ambient_dir(&root, cap_std::ambient_authority()).unwrap());
        *state.root.lock().unwrap() = Some(root);
        state
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
    #[cfg(test)]
    pub fn authorize_path(&self, path: &str) -> Result<(), String> {
        self.authorize_path_at(path, self.generation())
    }

    pub fn authorize_path_at(&self, path: &str, generation: u64) -> Result<(), String> {
        let _root = self.root.lock().map_err(|e| e.to_string())?;
        if self.generation() != generation {
            return Err(
                "[workspace.generation] Workspace changed before path authorization".into(),
            );
        }
        let canonical = Path::new(path)
            .canonicalize()
            .map_err(|error| format!("无法解析路径 {path}: {error}"))?;
        if canonical.is_file() {
            let parent = canonical
                .parent()
                .ok_or("[workspace.path] File has no parent")?;
            let directory =
                cap_std::fs::Dir::open_ambient_dir(parent, cap_std::ambient_authority())
                    .map_err(|e| e.to_string())?;
            let name = PathBuf::from(
                canonical
                    .file_name()
                    .ok_or("[workspace.path] Missing file name")?,
            );
            crate::scoped_file::open(&directory, &name).map_err(|e| e.to_string())?;
            let mut entries = self.authorized_files.lock().map_err(|e| e.to_string())?;
            if entries.len() >= 64 {
                return Err("[resource.limit] File authorization registry is full".into());
            }
            entries.insert(lexical_path(&canonical), (directory, name));
        }
        self.authorized
            .lock()
            .map_err(|_| workspace_error("Workspace authorization lock is poisoned"))?
            .insert(canonical);
        Ok(())
    }
}

fn lexical_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        if let Some(plain) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(plain);
        }
    }
    path.to_owned()
}

fn workspace_relative_path(root: &Path, requested: &Path) -> Result<PathBuf, String> {
    let root = lexical_path(root);
    let requested = lexical_path(requested);
    if let Ok(relative) = requested.strip_prefix(&root) {
        return Ok(relative.to_owned());
    }
    #[cfg(windows)]
    {
        if !windows_same_prefix(&root, &requested) {
            return Err("[workspace.boundary] Path is outside the active workspace".into());
        }
        let expanded = windows_long_path(&requested);
        if let Ok(relative) = expanded.strip_prefix(&root) {
            return Ok(relative.to_owned());
        }
        let mut remaining = expanded.components();
        let mut prefix = PathBuf::new();
        let matches = root.components().all(|component| {
            remaining.next().is_some_and(|candidate| {
                prefix.push(candidate.as_os_str());
                component
                    .as_os_str()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&candidate.as_os_str().to_string_lossy())
            })
        });
        // Resolve only the root prefix: child junctions must still be checked
        // through the pinned directory, and case-sensitive roots stay distinct.
        if matches
            && prefix
                .canonicalize()
                .is_ok_and(|path| lexical_path(&path) == root)
        {
            return Ok(remaining.as_path().to_owned());
        }
    }
    Err("[workspace.boundary] Path is outside the active workspace".into())
}

#[cfg(windows)]
fn windows_same_prefix(left: &Path, right: &Path) -> bool {
    match (left.components().next(), right.components().next()) {
        (Some(std::path::Component::Prefix(left)), Some(std::path::Component::Prefix(right))) => {
            left.as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
        }
        _ => false,
    }
}

#[cfg(windows)]
fn windows_long_path(path: &Path) -> PathBuf {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Storage::FileSystem::GetLongPathNameW;

    // Expand DOS aliases without resolving junctions. Traversal remains visible
    // to the scoped access checks, and missing targets keep their original tail.
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return path.to_owned();
    }
    let mut cursor = path;
    let mut tail = Vec::new();
    loop {
        let input = cursor
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let mut output = vec![0u16; input.len()];
        let mut length =
            unsafe { GetLongPathNameW(input.as_ptr(), output.as_mut_ptr(), output.len() as u32) }
                as usize;
        if length >= output.len() && length <= 32768 {
            output.resize(length, 0);
            length = unsafe {
                GetLongPathNameW(input.as_ptr(), output.as_mut_ptr(), output.len() as u32)
            } as usize;
        }
        if length > 0 && length < output.len() {
            let expanded = lexical_path(Path::new(&OsString::from_wide(&output[..length])));
            let mut wide = expanded.as_os_str().encode_wide().collect::<Vec<_>>();
            if wide.len() >= 2 && wide[1] == u16::from(b':') && wide[0] <= 127 {
                wide[0] = u16::from((wide[0] as u8).to_ascii_uppercase());
            }
            let mut expanded = PathBuf::from(OsString::from_wide(&wide));
            for name in tail.into_iter().rev() {
                expanded.push(name);
            }
            return expanded;
        }
        match (cursor.parent(), cursor.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name.to_owned());
                cursor = parent;
            }
            _ => return path.to_owned(),
        }
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

struct DirectoryCursor {
    entries: cap_std::fs::ReadDir,
    generation: u64,
    revision: u64,
    path: String,
    last_used: std::time::Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPage {
    entries: Vec<FsEntry>,
    next_cursor: Option<String>,
    generation: u64,
}

#[tauri::command]
pub fn fs_read_dir_page(
    state: State<'_, WorkspaceState>,
    path: String,
    cursor: Option<String>,
) -> Result<DirectoryPage, String> {
    directory_page(&state, path, cursor)
}

fn directory_page(
    state: &WorkspaceState,
    path: String,
    cursor: Option<String>,
) -> Result<DirectoryPage, String> {
    let generation = state.generation();
    let revision = state.directory_revision.load(Ordering::Acquire);
    let mut entry = if let Some(id) = cursor {
        let entry = state
            .cursors
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id)
            .ok_or("[directory.cursor] Cursor is missing or expired")?;
        if entry.generation != generation
            || entry.revision != revision
            || entry.path != path
            || entry.last_used.elapsed() > Duration::from_secs(60)
        {
            return Err("[directory.generation] Directory page has expired".into());
        }
        entry
    } else {
        let (parent, name) = state.access(&path, true)?;
        DirectoryCursor {
            entries: parent
                .open_dir_nofollow(name)
                .map_err(|e| e.to_string())?
                .entries()
                .map_err(|e| e.to_string())?,
            generation,
            revision,
            path,
            last_used: std::time::Instant::now(),
        }
    };
    let mut entries = Vec::with_capacity(crate::resource_limits::DIRECTORY_PAGE_ENTRIES);
    let mut complete = false;
    let mut inspected = 0usize;
    while entries.len() < crate::resource_limits::DIRECTORY_PAGE_ENTRIES && inspected < 1024 {
        let Some(next) = entry.entries.next() else {
            complete = true;
            break;
        };
        inspected += 1;
        let next = next.map_err(|e| e.to_string())?;
        let file_type = next.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        entries.push(FsEntry {
            name: next.file_name().to_string_lossy().into_owned(),
            is_directory: file_type.is_dir(),
        });
    }
    if state.generation() != generation
        || state.directory_revision.load(Ordering::Acquire) != revision
    {
        return Err("[directory.generation] Workspace changed during enumeration".into());
    }
    let next_cursor = if complete {
        None
    } else {
        let mut cursors = state.cursors.lock().map_err(|e| e.to_string())?;
        if state.generation() != generation
            || state.directory_revision.load(Ordering::Acquire) != revision
        {
            return Err(
                "[directory.generation] Directory changed before cursor registration".into(),
            );
        }
        cursors.retain(|_, entry| entry.last_used.elapsed() < Duration::from_secs(60));
        if cursors.len() >= 64 {
            return Err("[resource.limit] Directory cursor limit reached".into());
        }
        entry.last_used = std::time::Instant::now();
        let id = format!("directory-{:032x}", rand::random::<u128>());
        cursors.insert(id.clone(), entry);
        Some(id)
    };
    Ok(DirectoryPage {
        entries,
        next_cursor,
        generation,
    })
}

#[tauri::command]
pub fn fs_cancel_dir_cursor(
    state: State<'_, WorkspaceState>,
    cursor: String,
) -> Result<(), String> {
    state
        .cursors
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&cursor);
    Ok(())
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

fn reject_root_mutation(root: &Path, target: &Path) -> Result<(), String> {
    if target == root {
        return Err(
            "[workspace.root_protected] The workspace root cannot be removed or replaced".into(),
        );
    }
    Ok(())
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
pub async fn workspace_set_root(
    app: tauri::AppHandle,
    state: State<'_, WorkspaceState>,
    root: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let _transition = state.transition.lock().await;
    let generation = state.generation();
    if let Some(raw) = &root {
        if raw.is_empty()
            || raw.len() > 32768
            || raw.contains('\0')
            || !Path::new(raw).is_absolute()
        {
            return Err("[workspace.root] Workspace root must be an absolute directory".into());
        }
        let canonical = Path::new(raw)
            .canonicalize()
            .map_err(|_| "[workspace.root] Workspace directory is unavailable")?;
        if state.root()?.as_ref() == Some(&canonical) {
            return Ok(());
        }
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let (title, body) = crate::authorization_dialogs::text(
            &app,
            "workspace",
            &[("path", &canonical.to_string_lossy())],
        );
        #[cfg(feature = "audit-harness")]
        let isolated_workspace = canonical == crate::audit_harness::root(&app)?;
        #[cfg(not(feature = "audit-harness"))]
        let isolated_workspace = false;
        if isolated_workspace {
            let _ = sender.send(true);
        } else {
            app.dialog()
                .message(body)
                .title(title)
                .buttons(MessageDialogButtons::YesNo)
                .show(move |approved| {
                    let _ = sender.send(approved);
                });
        }
        if !matches!(
            tokio::time::timeout(Duration::from_secs(60), receiver).await,
            Ok(Ok(true))
        ) {
            return Err("[workspace.denied] Workspace was not authorized".into());
        }
        if Path::new(raw)
            .canonicalize()
            .map_err(|_| "[workspace.changed] Workspace disappeared during approval")?
            != canonical
        {
            return Err("[workspace.changed] Workspace changed during approval".into());
        }
    }
    {
        let mut guard = state
            .root
            .lock()
            .map_err(|_| workspace_error("Workspace state lock is poisoned"))?;
        if state.generation() != generation {
            return Err(
                "[workspace.generation] Another workspace was opened during approval".into(),
            );
        }
        match root {
            Some(raw) => {
                let requested = PathBuf::from(raw);
                let canonical = requested.canonicalize().map_err(|error| {
                    format!("无法解析工作区根目录 {}: {error}", requested.display())
                })?;
                if !canonical.is_dir() {
                    return Err(workspace_error("工作区根目录不是文件夹"));
                }
                let dir =
                    cap_std::fs::Dir::open_ambient_dir(&canonical, cap_std::ambient_authority())
                        .map_err(|error| error.to_string())?;
                *state.directory.lock().map_err(|e| e.to_string())? = Some(dir);
                *guard = Some(canonical);
            }
            None => {
                *guard = None;
                *state.directory.lock().map_err(|e| e.to_string())? = None;
            }
        }
        state.generation.fetch_add(1, Ordering::AcqRel);
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
    state.cursors.lock().map_err(|e| e.to_string())?.clear();
    state
        .authorized_files
        .lock()
        .map_err(|e| e.to_string())?
        .clear();
    crate::extensions::runtime::cleanup_extension_resources(None);
    app.state::<crate::extensions::state::ExtensionState>()
        .revoke_session();
    app.state::<crate::file_uploads::FileUploadState>().clear();
    app.state::<crate::marketplace::MarketplaceState>().clear();
    app.state::<crate::ai_profiles::AiProfileState>()
        .revoke_session();
    app.state::<crate::ai_chat::AiChatState>().abort_all();
    state
        .watchers
        .lock()
        .map_err(|_| workspace_error("Watcher state lock is poisoned"))?
        .clear();
    crate::commands::lsp_cmds::stop_workspace_sessions(app.state(), generation).await;
    crate::commands::dap_cmds::stop_workspace_sessions(app.state(), generation).await;
    crate::pty::close_workspace_sessions(&app, &app.state::<crate::pty::PtyState>(), generation);
    Ok(())
}

#[tauri::command]
pub async fn fs_read_dir(app: tauri::AppHandle, path: String) -> Result<Vec<FsEntry>, String> {
    let state = app.state::<WorkspaceState>();
    let (parent, name) = state.access(&path, true)?;
    let directory = parent.open_dir_nofollow(name).map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut entries = Vec::new();
        for entry in directory.entries().map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| format!("无法读取目录项: {error}"))?;
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                continue;
            }
            entries.push(FsEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                is_directory: file_type.is_dir(),
            });
            if entries.len() > 100_000 {
                return Err(
                    "[resource.limit] Use directory pagination for large directories".into(),
                );
            }
        }
        Ok(entries)
    })
    .await
    .map_err(|error| workspace_error(format!("读取目录任务失败: {error}")))?
}

#[tauri::command]
pub async fn fs_exists(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<WorkspaceState>().exists(&path))
        .await
        .map_err(|error| workspace_error(format!("文件检查任务失败: {error}")))?
}

#[tauri::command]
pub async fn fs_read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let state = app.state::<WorkspaceState>();
    let (directory, relative) = state.access(&path, true)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut options = cap_std::fs::OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let file = directory
            .open_with(relative, &options)
            .map_err(|error| error.to_string())?;
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.len() > crate::resource_limits::TEXT_BYTES as u64 {
            return Err("[resource.limit] Text file exceeds 32 MiB".into());
        }
        let mut text = String::new();
        file.take(crate::resource_limits::TEXT_BYTES as u64 + 1)
            .read_to_string(&mut text)
            .map_err(|error| error.to_string())?;
        if text.len() > crate::resource_limits::TEXT_BYTES {
            return Err("[resource.limit] Text file grew beyond 32 MiB".into());
        }
        Ok(text)
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
    let (directory, relative) = state.access(&path, true)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut options = cap_std::fs::OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let file = directory
            .open_with(relative, &options)
            .map_err(|error| error.to_string())?;
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
    if contents.len() > crate::resource_limits::TEXT_BYTES {
        return Err("[resource.limit] Text exceeds 32 MiB".into());
    }
    let (directory, relative) = state.write_access(&path)?;
    let generation = state.generation();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceState>();
        let _guard = state.root.lock().map_err(|e| e.to_string())?;
        if state.generation() != generation {
            return Err("[workspace.generation] Workspace changed".into());
        }
        if relative == Path::new(".") {
            return Err("[workspace.root_protected] Cannot replace the workspace root".into());
        }
        crate::scoped_file::write(&directory, &relative, contents.as_bytes())
    })
    .await
    .map_err(|error| workspace_error(format!("写入文件任务失败: {error}")))?
}

#[tauri::command]
pub fn workspace_generation(state: State<'_, WorkspaceState>) -> u64 {
    state.generation()
}

#[tauri::command]
pub async fn fs_write_compare(
    app: tauri::AppHandle,
    path: String,
    contents: String,
    expected_fingerprint: String,
    generation: u64,
) -> Result<(), String> {
    if contents.len() > crate::resource_limits::TEXT_BYTES {
        return Err("[resource.limit] Text exceeds 32 MiB".into());
    }
    let state = app.state::<WorkspaceState>();
    if state.generation() != generation {
        return Err("[workspace.generation] Workspace changed".into());
    }
    let (directory, name) = state.write_access(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceState>();
        state.with_generation(generation, || {
            let source = crate::scoped_file::open(&directory, &name).map_err(|e| e.to_string())?;
            let current = crate::scoped_file::snapshot(&source)?;
            if current.fingerprint != expected_fingerprint {
                return Err("[agent.recovery_conflict] File changed before recovery write".into());
            }
            let mut stage = crate::scoped_file::StagedFile::new(&directory)?;
            stage
                .file
                .write_all(contents.as_bytes())
                .map_err(|e| e.to_string())?;
            crate::scoped_file::verify_snapshot(&directory, &name, &current)?;
            drop(source);
            stage.commit(&name)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_mkdir(app: tauri::AppHandle, path: String, recursive: bool) -> Result<(), String> {
    if Path::new(&path).components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".aurona-recovery")
    }) {
        return Err("[workspace.recovery_protected] Recovery data is protected".into());
    }
    let state = app.state::<WorkspaceState>();
    let generation = state.generation();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceState>();
        let root_guard = state.root.lock().map_err(|e| e.to_string())?;
        if state.generation() != generation {
            return Err("[workspace.generation] Workspace changed".into());
        }
        let root = lexical_path(
            root_guard
                .as_ref()
                .ok_or("[workspace.closed] No active workspace")?,
        );
        let requested = lexical_path(Path::new(&path));
        let relative = requested
            .strip_prefix(root)
            .map_err(|_| "[workspace.boundary] Path is outside the workspace")?;
        let components: Vec<_> = relative.components().collect();
        let mut directory = state
            .directory
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .ok_or("[workspace.closed] No workspace handle")?
            .try_clone()
            .map_err(|e| e.to_string())?;
        for (index, component) in components.iter().enumerate() {
            if !matches!(component, std::path::Component::Normal(_)) {
                return Err("[workspace.boundary] Invalid path component".into());
            }
            if recursive || index + 1 == components.len() {
                match directory.create_dir(component.as_os_str()) {
                    Ok(()) => {}
                    Err(error) if recursive && error.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error.to_string()),
                }
            }
            directory = directory
                .open_dir_nofollow(component.as_os_str())
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|error| workspace_error(format!("创建文件夹任务失败: {error}")))?
}

#[tauri::command]
pub async fn fs_remove(app: tauri::AppHandle, path: String, recursive: bool) -> Result<(), String> {
    let state = app.state::<WorkspaceState>();
    let generation = state.generation();
    let (directory, name) = state.write_access(&path)?;
    if name == Path::new(".") {
        return Err("[workspace.root_protected] Cannot remove the workspace root".into());
    }
    if lexical_path(Path::new(&path))
        .components()
        .any(|component| component.as_os_str() == ".aurona-recovery")
    {
        return Err(
            "[recovery.protected] Recovery data cannot be deleted through file operations".into(),
        );
    }
    let preview_dir = directory.try_clone().map_err(|e| e.to_string())?;
    let preview_name = name.clone();
    let preview = tokio::task::spawn_blocking(move || tree_digest(&preview_dir, &preview_name))
        .await
        .map_err(|e| e.to_string())??;
    if !recursive
        && directory
            .symlink_metadata(&name)
            .map_err(|e| e.to_string())?
            .is_dir()
        && directory
            .open_dir_nofollow(&name)
            .map_err(|e| e.to_string())?
            .entries()
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err("[workspace.directory_not_empty] Directory is not empty".into());
    }
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let (title, body) = crate::authorization_dialogs::text(
        &app,
        "delete",
        &[
            ("path", &path),
            ("entries", &preview.1.to_string()),
            ("bytes", &preview.2.to_string()),
            ("fingerprint", &preview.0),
        ],
    );
    app.dialog()
        .message(body)
        .title(title)
        .buttons(MessageDialogButtons::YesNo)
        .show(move |confirmed| {
            let _ = sender.send(confirmed);
        });
    if !tokio::time::timeout(Duration::from_secs(60), receiver)
        .await
        .map_err(|_| "[confirmation.expired] Delete confirmation expired")?
        .unwrap_or(false)
    {
        return Err("[operation.cancelled] Delete cancelled".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceState>();
        let _guard = state.root.lock().map_err(|e| e.to_string())?;
        if state.generation() != generation { return Err("[workspace.generation] Workspace changed".into()); }
        if tree_digest(&directory, &name)? != preview { return Err("[confirmation.changed] Delete target changed after preview".into()); }
        let root = state.directory.lock().map_err(|e| e.to_string())?.as_ref().ok_or("[workspace.closed] Workspace closed")?.try_clone().map_err(|e| e.to_string())?;
        match root.create_dir(".aurona-recovery") { Ok(()) => {}, Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}, Err(error) => return Err(error.to_string()) }
        let recovery = root.open_dir_nofollow(".aurona-recovery").map_err(|e| e.to_string())?;
        if tree_digest(&root, Path::new(".aurona-recovery"))?.2 + preview.2 > 256 * 1024 * 1024 {
            return Err("[resource.limit] Recovery quota exceeded; delete was not performed".into());
        }
        let recovery_id = format!("deleted-{:032x}", rand::random::<u128>());
        recovery.create_dir(&recovery_id).map_err(|e| e.to_string())?;
        let transaction = recovery.open_dir_nofollow(&recovery_id).map_err(|e| e.to_string())?;
        let metadata = serde_json::to_vec(&serde_json::json!({ "schemaVersion": 1, "originalPath": path, "fingerprint": preview.0, "entries": preview.1, "bytes": preview.2 })).map_err(|e| e.to_string())?;
        let mut log = transaction.create("transaction.json").map_err(|e| e.to_string())?;
        log.write_all(&metadata).and_then(|_| log.sync_all()).map_err(|e| e.to_string())?;
        directory.rename(&name, &transaction, "content").map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|error| workspace_error(format!("删除任务失败: {error}")))?
}

#[tauri::command]
pub async fn fs_restore_deleted(
    app: tauri::AppHandle,
    recovery_id: String,
) -> Result<String, String> {
    if !recovery_id.starts_with("deleted-")
        || recovery_id.len() != 40
        || !recovery_id[8..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("[recovery.id] Invalid recovery ID".into());
    }
    let state = app.state::<WorkspaceState>();
    let generation = state.generation();
    let root_path = current_root(&state)?;
    let (root, _) = state.access(&root_path.to_string_lossy(), true)?;
    let transaction = root
        .open_dir_nofollow(".aurona-recovery")
        .and_then(|directory| directory.open_dir_nofollow(&recovery_id))
        .map_err(|e| e.to_string())?;
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let mut log = String::new();
    transaction
        .open_with("transaction.json", &options)
        .map_err(|e| e.to_string())?
        .take(16385)
        .read_to_string(&mut log)
        .map_err(|e| e.to_string())?;
    if log.len() > 16384 {
        return Err("[recovery.log] Recovery record exceeds limit".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(&log).map_err(|_| "[recovery.log] Corrupt recovery record")?;
    let path = value
        .get("originalPath")
        .and_then(serde_json::Value::as_str)
        .ok_or("[recovery.log] Missing original path")?
        .to_string();
    let expected = value
        .get("fingerprint")
        .and_then(serde_json::Value::as_str)
        .ok_or("[recovery.log] Missing fingerprint")?
        .to_string();
    let (destination, name) = state.access(&path, false)?;
    if name == Path::new(".") || destination.symlink_metadata(&name).is_ok() {
        return Err(
            "[recovery.conflict] Restore destination exists or is the workspace root".into(),
        );
    }
    tokio::task::spawn_blocking(move || {
        let state = app.state::<WorkspaceState>();
        let _guard = state.root.lock().map_err(|e| e.to_string())?;
        if generation != state.generation() {
            return Err("[workspace.generation] Workspace changed".into());
        }
        if tree_digest(&transaction, Path::new("content"))?.0 != expected {
            return Err("[recovery.changed] Recovery data changed".into());
        }
        if destination.symlink_metadata(&name).is_ok() {
            return Err("[recovery.conflict] Restore destination exists".into());
        }
        transaction
            .rename("content", &destination, &name)
            .map_err(|e| e.to_string())?;
        Ok(path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_rename(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    let state = app.state::<WorkspaceState>();
    let generation = state.generation();
    let (source, source_name) = state.write_access(&from)?;
    let (destination, destination_name) = state.write_access(&to)?;
    if source_name == Path::new(".") || destination_name == Path::new(".") {
        return Err("[workspace.root_protected] Cannot move or replace the workspace root".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceState>();
        let _guard = state.root.lock().map_err(|e| e.to_string())?;
        if state.generation() != generation {
            return Err("[workspace.generation] Workspace changed".into());
        }
        if destination.symlink_metadata(&destination_name).is_ok() {
            return Err("[workspace.exists] Destination already exists".into());
        }
        source
            .rename(source_name, &destination, destination_name)
            .map_err(|error| error.to_string())
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
    if contents.len() > crate::resource_limits::TEXT_BYTES {
        return Err("[resource.limit] Export text exceeds 32 MiB".into());
    }
    if default_name.is_empty()
        || default_name.len() > 128
        || default_name.contains(['/', '\\', '\0', ':'])
    {
        return Err("[file.name] Invalid export filename".into());
    }

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
        let parent = target
            .parent()
            .ok_or("[file.path] Export destination has no parent")?;
        let name = target
            .file_name()
            .ok_or("[file.path] Export destination has no filename")?;
        let directory = cap_std::fs::Dir::open_ambient_dir(parent, cap_std::ambient_authority())
            .map_err(|e| e.to_string())?;
        crate::scoped_file::write(&directory, Path::new(name), contents.as_bytes())?;
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
    let generation = state.generation();
    let target = resolve_workspace_path(&root, &path, true)?;
    if !target.is_dir() {
        return Err(workspace_error(format!("只能监听文件夹: {path}")));
    }

    let mode = if recursive {
        notify::RecursiveMode::Recursive
    } else {
        notify::RecursiveMode::NonRecursive
    };
    let mut registry = state.watchers.lock().map_err(|error| error.to_string())?;
    let watcher_lease = crate::resource_limits::acquire_watcher(generation, None)?;
    if registry.len() >= crate::resource_limits::WORKSPACE_WATCHERS {
        return Err("[resource.limit] Workspace watcher limit reached".into());
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel::<notify::Result<notify::Event>>(256);
    let overflow = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let event_overflow = overflow.clone();
    let stopped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if sender.try_send(event).is_err() {
            event_overflow.store(true, Ordering::Release);
        }
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
    registry.insert(
        id.clone(),
        WorkspaceWatcher {
            _watcher: watcher,
            _lease: watcher_lease,
            stopped: stopped.clone(),
        },
    );
    drop(registry);

    let event_app = app.clone();
    let event_id = id.clone();
    std::thread::spawn(move || {
        let mut pending = crate::resource_limits::WatchBatch::default();
        let mut last_emit = std::time::Instant::now();
        loop {
            let workspace = event_app.state::<WorkspaceState>();
            if stopped.load(Ordering::Acquire) || workspace.generation() != generation {
                break;
            }
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(event)) => {
                    for changed in event.paths {
                        pending.push(changed.to_string_lossy().into_owned());
                    }
                }
                Ok(Err(_)) => {
                    overflow.store(true, Ordering::Release);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if pending.has_events() || overflow.load(Ordering::Acquire) {
                        let (paths, batch_overflow) = pending.take();
                        let payload = WorkspaceWatchEvent {
                            id: event_id.clone(),
                            kind: if overflow.swap(false, Ordering::AcqRel) || batch_overflow {
                                "overflow"
                            } else {
                                "any"
                            }
                            .to_string(),
                            paths,
                        };
                        if let Ok(mut cursors) = event_app.state::<WorkspaceState>().cursors.lock()
                        {
                            workspace.directory_revision.fetch_add(1, Ordering::AcqRel);
                            cursors.clear();
                        }
                        let _ = event_app.emit("fs:changed", payload);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
            if last_emit.elapsed() >= Duration::from_millis(100)
                && (pending.has_events() || overflow.load(Ordering::Acquire))
            {
                let (paths, batch_overflow) = pending.take();
                let payload = WorkspaceWatchEvent {
                    id: event_id.clone(),
                    kind: if overflow.swap(false, Ordering::AcqRel) || batch_overflow {
                        "overflow"
                    } else {
                        "any"
                    }
                    .into(),
                    paths,
                };
                if let Ok(mut cursors) = event_app.state::<WorkspaceState>().cursors.lock() {
                    workspace.directory_revision.fetch_add(1, Ordering::AcqRel);
                    cursors.clear();
                }
                let _ = event_app.emit("fs:changed", payload);
                last_emit = std::time::Instant::now();
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
    fn scoped_state(root: &std::path::Path) -> super::WorkspaceState {
        let state = super::WorkspaceState::new();
        let root = root.canonicalize().unwrap();
        *state.directory.lock().unwrap() =
            Some(cap_std::fs::Dir::open_ambient_dir(&root, cap_std::ambient_authority()).unwrap());
        *state.root.lock().unwrap() = Some(root);
        state
    }

    #[test]
    fn production_scope_rejects_forged_roots_and_traversal() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(root.path().join("inside.txt"), "inside").unwrap();
        fs::write(outside.path().join("outside.txt"), "outside").unwrap();
        let state = scoped_state(root.path());
        assert!(state
            .access(&root.path().join("inside.txt").to_string_lossy(), true)
            .is_ok());
        assert!(state
            .access(&outside.path().join("outside.txt").to_string_lossy(), true)
            .is_err());
        assert!(state
            .access(&root.path().join("../outside.txt").to_string_lossy(), false)
            .is_err());
        assert!(state.access("", false).is_err());
        assert_eq!(
            state
                .access(&root.path().to_string_lossy(), true)
                .unwrap()
                .1,
            std::path::Path::new(".")
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_scope_accepts_case_and_dos_aliases_without_expanding_authority() {
        use std::ffi::OsString;
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

        fn short_path(path: &std::path::Path) -> std::path::PathBuf {
            let input = path
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            let mut output = vec![0u16; 32768];
            let length = unsafe {
                GetShortPathNameW(input.as_ptr(), output.as_mut_ptr(), output.len() as u32)
            } as usize;
            assert!(length > 0 && length < output.len());
            OsString::from_wide(&output[..length]).into()
        }

        let root = tempfile::Builder::new()
            .prefix("Aurona Workspace Long Name ")
            .tempdir()
            .unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(root.path().join("Inside File.txt"), b"inside").unwrap();
        fs::write(outside.path().join("Selected File.txt"), b"outside").unwrap();
        fs::create_dir(root.path().join(".aurona-recovery")).unwrap();
        fs::write(root.path().join(".aurona-recovery/protected"), b"recovery").unwrap();
        let state = scoped_state(root.path());
        assert!(state
            .access(r"\\aurona-no-authority.invalid\share\file", true)
            .is_err());
        assert!(state
            .file_access(r"\\aurona-no-authority.invalid\share\file")
            .is_err());
        let short_root = short_path(root.path());
        for alias in [
            root.path().to_string_lossy().to_lowercase(),
            root.path().to_string_lossy().to_uppercase(),
            short_root.to_string_lossy().into_owned(),
        ] {
            let alias = std::path::Path::new(&alias);
            let inside = alias.join("Inside File.txt");
            let (directory, name) = state.file_access(&inside.to_string_lossy()).unwrap();
            let mut file = crate::scoped_file::open(&directory, &name).unwrap();
            let mut contents = Vec::new();
            use std::io::Read;
            file.read_to_end(&mut contents).unwrap();
            assert_eq!(contents, b"inside");
            assert!(state.exists(&inside.to_string_lossy()).unwrap());
            assert!(!state
                .exists(&alias.join("new.txt").to_string_lossy())
                .unwrap());
            assert!(state
                .write_access(&alias.join("new.txt").to_string_lossy())
                .is_ok());
            assert!(state.write_access(&alias.to_string_lossy()).is_err());
            assert!(state
                .access(&alias.join("../escape.txt").to_string_lossy(), false)
                .is_err());
            assert!(state
                .write_access(&alias.join(".AURONA-RECOVERY/protected").to_string_lossy())
                .is_err());
        }
        let protected = short_path(&root.path().join(".aurona-recovery/protected"));
        assert!(state.write_access(&protected.to_string_lossy()).is_err());

        let selected = outside.path().join("Selected File.txt");
        assert!(state
            .file_access(&selected.to_string_lossy().to_lowercase())
            .is_err());
        state.authorize_path(&selected.to_string_lossy()).unwrap();
        assert!(state
            .file_access(r"\\aurona-no-authority.invalid\share\file")
            .is_err());
        assert!(state
            .file_access(&selected.to_string_lossy().to_lowercase())
            .is_ok());
        assert!(state
            .file_access(&short_path(&selected).to_string_lossy())
            .is_ok());
        assert!(state.access(&selected.to_string_lossy(), true).is_err());
        assert!(state
            .file_access(&outside.path().join("unselected").to_string_lossy())
            .is_err());

        let link = root.path().join("junction");
        assert!(std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap()
            .status
            .success());
        let linked = short_root.join("JUNCTION/Selected File.txt");
        assert!(state.file_access(&linked.to_string_lossy()).is_err());
        fs::remove_dir(link).unwrap();
    }

    #[test]
    fn directory_pages_are_bounded_single_use_cancellable_and_invalidated_by_changes() {
        let root = tempfile::tempdir().unwrap();
        for i in 0..1025 {
            fs::write(root.path().join(format!("entry-{i}")), b"").unwrap();
        }
        let state = scoped_state(root.path());
        let path = root.path().to_string_lossy().into_owned();
        let first = super::directory_page(&state, path.clone(), None).unwrap();
        assert_eq!(
            first.entries.len(),
            crate::resource_limits::DIRECTORY_PAGE_ENTRIES
        );
        let cursor = first.next_cursor.unwrap();
        let second = super::directory_page(&state, path.clone(), Some(cursor.clone())).unwrap();
        assert!(super::directory_page(&state, path.clone(), Some(cursor)).is_err());
        let cursor = second.next_cursor.unwrap();
        state
            .directory_revision
            .fetch_add(1, super::Ordering::AcqRel);
        assert!(super::directory_page(&state, path.clone(), Some(cursor)).is_err());
        let first = super::directory_page(&state, path.clone(), None).unwrap();
        let cursor = first.next_cursor.unwrap();
        state.cursors.lock().unwrap().remove(&cursor);
        assert!(super::directory_page(&state, path.clone(), Some(cursor)).is_err());
        let mut count = 0;
        let mut cursor = None;
        loop {
            let page = super::directory_page(&state, path.clone(), cursor).unwrap();
            assert!(page.entries.len() <= crate::resource_limits::DIRECTORY_PAGE_ENTRIES);
            count += page.entries.len();
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(count, 1025);
        assert!(state.cursors.lock().unwrap().is_empty());
    }

    #[test]
    fn mutation_access_rejects_root_aliases_recovery_data_and_stale_authorization() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("selected"), b"outside").unwrap();
        let state = scoped_state(root.path());
        for path in [
            root.path().to_path_buf(),
            root.path().join("."),
            root.path().join(".aurona-recovery"),
            root.path().join(".AURONA-RECOVERY"),
        ] {
            assert!(state.write_access(&path.to_string_lossy()).is_err());
        }
        assert!(state.write_access("").is_err());
        state.generation.fetch_add(1, super::Ordering::AcqRel);
        assert!(state
            .authorize_path_at(&outside.path().join("selected").to_string_lossy(), 0)
            .is_err());
        assert!(state.authorized.lock().unwrap().is_empty());
    }

    #[test]
    fn parent_link_replacement_cannot_escape_during_reads_and_staged_writes() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let slot = root.path().join("slot");
        let link = root.path().join("link");
        let parked = root.path().join("parked");
        fs::create_dir(&slot).unwrap();
        fs::write(slot.join("text"), b"inside").unwrap();
        fs::write(outside.path().join("text"), b"secret").unwrap();
        #[cfg(windows)]
        assert!(std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap()
            .status
            .success());
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        let state = scoped_state(root.path());
        let target = slot.join("text");
        let (advance, step) = std::sync::mpsc::sync_channel(0);
        let (result, changed) = std::sync::mpsc::sync_channel(0);
        let worker = std::thread::spawn(move || {
            for _ in 0..100 {
                if step
                    .recv_timeout(std::time::Duration::from_secs(2))
                    .is_err()
                {
                    return;
                }
                let replaced = fs::rename(&slot, &parked).is_ok();
                if replaced {
                    fs::rename(&link, &slot).unwrap();
                }
                if result.send(replaced).is_err() {
                    return;
                }
                if step
                    .recv_timeout(std::time::Duration::from_secs(2))
                    .is_err()
                {
                    return;
                }
                if replaced {
                    fs::rename(&slot, &link).unwrap();
                    fs::rename(&parked, &slot).unwrap();
                }
                if result.send(false).is_err() {
                    return;
                }
            }
            #[cfg(windows)]
            fs::remove_dir(&link).unwrap();
            #[cfg(unix)]
            fs::remove_file(&link).unwrap();
        });
        let mut replacements = 0;
        for _ in 0..100 {
            let (dir, name) = state.access(&target.to_string_lossy(), true).unwrap();
            advance.send(()).unwrap();
            let replaced = changed
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap();
            if replaced {
                replacements += 1;
                assert!(state.access(&target.to_string_lossy(), true).is_err());
            }
            let mut file = crate::scoped_file::open(&dir, &name).unwrap();
            use std::io::Read;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).unwrap();
            assert_eq!(bytes, b"inside");
            drop(file);
            crate::scoped_file::write(&dir, &name, b"inside").unwrap();
            drop(dir);
            advance.send(()).unwrap();
            changed
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap();
        }
        worker.join().unwrap();
        #[cfg(unix)]
        assert_eq!(replacements, 100);
        eprintln!(
            "Parent replacement: {replacements} swapped, {} rejected by OS handle sharing",
            100 - replacements
        );
        assert_eq!(fs::read(outside.path().join("text")).unwrap(), b"secret");
    }

    #[test]
    fn recovery_fingerprint_survives_a_rename_and_detects_same_size_rewrites() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("original"), "before").unwrap();
        let state = scoped_state(root.path());
        let (directory, name) = state
            .access(&root.path().join("original").to_string_lossy(), true)
            .unwrap();
        let before = super::tree_digest(&directory, &name).unwrap();
        directory.rename("original", &directory, "content").unwrap();
        assert_eq!(
            before,
            super::tree_digest(&directory, std::path::Path::new("content")).unwrap()
        );
        fs::write(root.path().join("content"), "after!").unwrap();
        assert_ne!(
            before.0,
            super::tree_digest(&directory, std::path::Path::new("content"))
                .unwrap()
                .0
        );
    }

    #[cfg(windows)]
    #[test]
    fn production_scope_refuses_a_junction_to_an_external_target() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "secret").unwrap();
        let link = root.path().join("link");
        let output = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(output.status.success(), "Junction fixture failed");
        let state = scoped_state(root.path());
        assert!(state
            .access(&link.join("secret.txt").to_string_lossy(), true)
            .is_err());
        assert!(state.access(&link.to_string_lossy(), true).is_err());
        assert_eq!(
            fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
            "secret"
        );
        fs::remove_dir(&link).unwrap();
    }
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

        drop(state);
        fs::remove_dir_all(root).expect("remove workspace");
        fs::remove_dir_all(outside).expect("remove outside directory");
    }
}
