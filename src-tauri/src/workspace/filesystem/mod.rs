//! Filesystem use cases scoped by the workspace capability.
use super::*;

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPage {
    entries: Vec<FsEntry>,
    next_cursor: Option<String>,
    generation: u64,
}

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

pub async fn workspace_set_root(
    app: tauri::AppHandle,
    state: State<'_, WorkspaceState>,
    root: Option<String>,
) -> Result<(), String> {
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
        #[cfg(feature = "audit-harness")]
        let isolated_workspace = canonical == crate::audit_harness::root(&app)?;
        #[cfg(not(feature = "audit-harness"))]
        let isolated_workspace = false;
        if !isolated_workspace
            && crate::authorization_dialogs::security_preference(
                &app,
                "requireWorkspaceApproval",
                true,
            )
            && !crate::workspace_approval::request(&app, &canonical.to_string_lossy()).await?
        {
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

pub async fn fs_exists(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<WorkspaceState>().exists(&path))
        .await
        .map_err(|error| workspace_error(format!("文件检查任务失败: {error}")))?
}

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

pub fn workspace_generation(state: State<'_, WorkspaceState>) -> u64 {
    state.generation()
}

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
    if crate::authorization_dialogs::security_preference(&app, "requireDeleteApproval", true) {
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

pub fn fs_watch_stop(state: State<WorkspaceState>, id: String) -> Result<(), String> {
    state
        .watchers
        .lock()
        .map_err(|_| workspace_error("Watcher state lock is poisoned"))?
        .remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests;
