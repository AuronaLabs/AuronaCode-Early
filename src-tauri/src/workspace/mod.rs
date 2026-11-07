//! Canonical workspace capability, authorization and resource ownership.
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

mod digest;
use digest::tree_digest;
pub mod filesystem;
pub mod ipc;

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
        #[cfg(unix)]
        let key = if authorized.contains_key(&key) {
            key
        } else if key.is_absolute()
            && !authorized.is_empty()
            && !key
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            key.canonicalize()
                .map_err(|_| "[workspace.authorization] File has not been selected by the user")?
        } else {
            key
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
    #[cfg(unix)]
    if requested.is_absolute()
        && !requested
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        // Only resolve a root alias (e.g. /var vs /private/var on macOS).
        // Descendants still walk from the fixed no-follow directory handle.
        for prefix in requested.ancestors() {
            if prefix.canonicalize().is_ok_and(|path| path == root) {
                return Ok(requested
                    .strip_prefix(prefix)
                    .map_err(|e| e.to_string())?
                    .to_owned());
            }
        }
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

struct DirectoryCursor {
    entries: cap_std::fs::ReadDir,
    generation: u64,
    revision: u64,
    path: String,
    last_used: std::time::Instant,
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
