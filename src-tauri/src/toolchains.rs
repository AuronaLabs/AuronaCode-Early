use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;
use zip::ZipArchive;

static TOOL_MUTATIONS: std::sync::LazyLock<
    std::sync::Mutex<HashMap<String, std::sync::Arc<std::sync::Mutex<()>>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

type ToolUseLock = std::sync::Arc<tokio::sync::RwLock<()>>;
pub type ToolUseLease = Vec<tokio::sync::OwnedRwLockReadGuard<()>>;
static TOOL_USERS: std::sync::LazyLock<std::sync::Mutex<HashMap<String, ToolUseLock>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

fn use_lock(id: &str) -> Result<ToolUseLock, String> {
    let mut locks = TOOL_USERS
        .lock()
        .map_err(|_| "[toolchain.state] Tool use registry unavailable")?;
    locks.retain(|_, lock| std::sync::Arc::strong_count(lock) > 1);
    if locks.len() >= 128 && !locks.contains_key(id) {
        return Err("[resource.limit] Tool use registry is full".into());
    }
    Ok(locks.entry(id.into()).or_default().clone())
}

fn exclusive_use(id: &str) -> Result<tokio::sync::OwnedRwLockWriteGuard<()>, String> {
    use_lock(id)?.try_write_owned().map_err(|_| "[toolchain.in_use] Stop processes using this toolchain before replacing or uninstalling it".into())
}

fn resource_for_path(base: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(base).ok()?;
    let mut parts = relative.components();
    let kind = parts.next()?.as_os_str().to_str()?;
    let id = parts.next()?.as_os_str().to_str()?;
    if validate_toolchain_segment(id).is_err() {
        return None;
    }
    match kind {
        "servers" => Some(format!("server:{id}")),
        "runtimes" => Some(format!("runtime:{id}")),
        _ => None,
    }
}

pub fn acquire_launch_use(
    app: &tauri::AppHandle,
    command: &str,
    args: &[String],
    cwd: &str,
) -> Result<ToolUseLease, String> {
    let base = get_toolchains_base_dir(app)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let mut ids = std::collections::BTreeSet::new();
    for argument in std::iter::once(command).chain(args.iter().map(String::as_str)) {
        let requested = Path::new(argument);
        let path = if requested.is_absolute() {
            requested.to_owned()
        } else {
            Path::new(cwd).join(requested)
        };
        // Resolve before and after acquiring the lease through the launch fingerprint.
        if let Ok(path) = path.canonicalize() {
            if let Some(id) = resource_for_path(&base, &path) {
                ids.insert(id);
            }
        }
    }
    ids.into_iter()
        .map(|id| {
            use_lock(&id)?
                .try_read_owned()
                .map_err(|_| "[toolchain.busy] Toolchain is being changed; retry the launch".into())
        })
        .collect()
}

fn mutation_lock(id: &str) -> Result<std::sync::Arc<std::sync::Mutex<()>>, String> {
    let mut locks = TOOL_MUTATIONS
        .lock()
        .map_err(|_| "[toolchain.state] Task coordinator unavailable")?;
    locks.retain(|_, lock| std::sync::Arc::strong_count(lock) > 1);
    if locks.len() >= 128 && !locks.contains_key(id) {
        return Err("[resource.limit] Too many toolchain operations".into());
    }
    Ok(locks.entry(id.into()).or_default().clone())
}

fn check_cancel(cancel: Option<&std::sync::atomic::AtomicBool>) -> Result<(), String> {
    if cancel.is_some_and(|c| c.load(std::sync::atomic::Ordering::Acquire)) {
        return Err("[task.cancelled] Toolchain installation cancelled".into());
    }
    Ok(())
}

fn reserve_space(path: &Path, bytes: u64) -> Result<(), String> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let disk = disks
        .iter()
        .filter(|disk| path.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().components().count())
        .ok_or("[archive.space] Cannot determine available disk space")?;
    validate_available_space(disk.available_space(), bytes)
}

fn validate_available_space(available: u64, bytes: u64) -> Result<(), String> {
    if available < bytes.saturating_add(512 * 1024 * 1024) {
        return Err("[archive.space] Installation must retain 512 MiB of free space".into());
    }
    Ok(())
}

fn archive_preflight(
    zip: &mut ZipArchive<impl Read + std::io::Seek>,
    check: impl Fn() -> Result<(), String>,
) -> Result<u64, String> {
    if zip.len() > crate::resource_limits::ARCHIVE_ENTRIES {
        return Err("[archive.entry_limit] Too many archive entries".into());
    }
    let mut names = std::collections::HashSet::new();
    let mut total = 0u64;
    for index in 0..zip.len() {
        check()?;
        let file = zip.by_index(index).map_err(|e| e.to_string())?;
        let name = file.name().trim_end_matches('/');
        if name.is_empty()
            || name.contains(['\\', ':', '\0'])
            || name.split('/').any(|part| {
                part.is_empty() || matches!(part, "." | "..") || part.ends_with(['.', ' '])
            })
            || file.enclosed_name().is_none()
        {
            return Err("[archive.path] Unsafe or nonportable archive path".into());
        }
        if !names.insert(name.to_lowercase()) {
            return Err("[archive.duplicate] Duplicate archive path".into());
        }
        if file
            .unix_mode()
            .is_some_and(|mode| !matches!(mode & 0o170000, 0 | 0o100000 | 0o040000))
        {
            return Err("[archive.special_file] Links and special files are prohibited".into());
        }
        total = total
            .checked_add(file.size())
            .ok_or("[archive.expansion_limit] Archive size overflow")?;
        if file.size() > crate::resource_limits::EXPANDED_ENTRY_BYTES
            || total > crate::resource_limits::EXPANDED_BYTES
            || file.size()
                > file
                    .compressed_size()
                    .max(1)
                    .saturating_mul(crate::resource_limits::COMPRESSION_RATIO)
        {
            return Err("[archive.expansion_limit] Archive exceeds extraction budget".into());
        }
    }
    Ok(total)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspManifestRuntime {
    #[serde(rename = "type")]
    pub runtime_type: String,
    pub min_version: Option<String>,
    pub entry: String,
    pub exec_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspManifestCommand {
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspPackageManifest {
    #[serde(default)]
    pub schema_version: Option<u32>,
    pub kind: Option<String>,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: Option<HashMap<String, String>>,
    pub version: String,
    #[serde(default)]
    pub languages: Vec<String>,
    pub runtime: LspManifestRuntime,
    #[serde(default)]
    pub command: Option<LspManifestCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePackageManifest {
    #[serde(default)]
    pub schema_version: Option<u32>,
    pub kind: Option<String>,
    pub id: String,
    pub version: String,
    pub runtime_type: String,
    pub runtime_version: String,
    pub binary_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledToolchainSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub languages: Vec<String>,
    pub runtime_type: String,
    pub install_path: String,
    pub disk_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRuntimeSummary {
    pub runtime_type: String,
    pub version: String,
    pub binary_path: String,
    pub disk_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainsOverview {
    pub servers: Vec<InstalledToolchainSummary>,
    pub runtimes: Vec<InstalledRuntimeSummary>,
    pub total_bytes: u64,
}

pub fn get_toolchains_base_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法获取 AppLocalData 目录: {e}"))?;
    let dir = local_data.join("toolchains");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建 toolchains 目录: {e}"))?;
    Ok(dir)
}

fn validate_toolchain_segment(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || value.starts_with('.')
        || value.ends_with('.')
        || value.contains("..")
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'+'))
    {
        return Err(format!("Invalid toolchain path segment: {value}"));
    }
    Ok(())
}

fn checked_child_directory(parent: &Path, child: &str, create: bool) -> Result<PathBuf, String> {
    validate_toolchain_segment(child)?;
    let canonical_parent = parent.canonicalize().map_err(|error| error.to_string())?;
    let path = parent.join(child);
    if create && !path.exists() {
        fs::create_dir(&path).map_err(|error| error.to_string())?;
    }
    if path.exists() {
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!("Unsafe toolchain directory: {}", path.display()));
        }
        let canonical = path.canonicalize().map_err(|error| error.to_string())?;
        if canonical.parent() != Some(canonical_parent.as_path()) {
            return Err(format!(
                "Toolchain directory escaped its parent: {}",
                path.display()
            ));
        }
    }
    Ok(path)
}

struct InstallStagingDir(PathBuf);

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct InstallJournal {
    schema: u8,
    destination: String,
    stage: String,
    backup: String,
    had_previous: bool,
    committed: bool,
}

fn recover_install(parent: &cap_std::fs::Dir) -> Result<(), String> {
    let name = Path::new(".aurona-install.json");
    let file = match crate::scoped_file::open(parent, name) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let mut bytes = Vec::new();
    file.take(16385)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16384 {
        return Err("[toolchain.recovery] Oversized install journal".into());
    }
    let journal: InstallJournal = serde_json::from_slice(&bytes)
        .map_err(|_| "[toolchain.recovery] Invalid journal; installation preserved")?;
    if journal.schema != 1
        || !journal.stage.starts_with("stage-")
        || !journal.backup.starts_with("backup-")
    {
        return Err("[toolchain.recovery] Invalid journal identity".into());
    }
    for segment in [&journal.destination, &journal.stage, &journal.backup] {
        validate_toolchain_segment(segment)?;
    }
    if journal.destination == journal.stage
        || journal.destination == journal.backup
        || journal.stage == journal.backup
    {
        return Err("[toolchain.recovery] Overlapping journal paths".into());
    }
    let exists = |path: &str| -> Result<bool, String> {
        match parent.symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                Err("[toolchain.recovery] Unsafe recovery directory".into())
            }
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    };
    let destination = exists(&journal.destination)?;
    let backup = exists(&journal.backup)?;
    let stage = exists(&journal.stage)?;
    if !journal.committed {
        if backup {
            if destination {
                parent
                    .remove_dir_all(&journal.destination)
                    .map_err(|e| e.to_string())?;
            }
            parent
                .rename(&journal.backup, parent, &journal.destination)
                .map_err(|e| e.to_string())?;
        } else if journal.had_previous && !destination {
            return Err(
                "[toolchain.recovery] Previous installation is missing; journal retained".into(),
            );
        } else if !journal.had_previous && !stage && destination {
            parent
                .remove_dir_all(&journal.destination)
                .map_err(|e| e.to_string())?;
        }
    } else if !destination {
        return Err(
            "[toolchain.recovery] Committed installation is missing; journal retained".into(),
        );
    }
    if exists(&journal.stage)? {
        parent
            .remove_dir_all(&journal.stage)
            .map_err(|e| e.to_string())?;
    }
    if exists(&journal.backup)? {
        parent
            .remove_dir_all(&journal.backup)
            .map_err(|e| e.to_string())?;
    }
    parent.remove_file(name).map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct UninstallJournal {
    schema: u8,
    destination: String,
    tombstone: String,
    committed: bool,
}

fn recover_uninstall(parent: &cap_std::fs::Dir) -> Result<(), String> {
    let file = match crate::scoped_file::open(parent, Path::new(".aurona-uninstall.json")) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let mut bytes = Vec::new();
    file.take(16385)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16384 {
        return Err("[toolchain.recovery] Oversized uninstall journal".into());
    }
    let journal: UninstallJournal = serde_json::from_slice(&bytes)
        .map_err(|_| "[toolchain.recovery] Invalid uninstall journal; data preserved")?;
    validate_toolchain_segment(&journal.destination)?;
    validate_toolchain_segment(&journal.tombstone)?;
    if journal.schema != 1
        || !journal.tombstone.starts_with("uninstall-")
        || journal.destination == journal.tombstone
    {
        return Err("[toolchain.recovery] Invalid uninstall identity".into());
    }
    let exists = |name: &str| -> Result<bool, String> {
        match parent.symlink_metadata(name) {
            Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
                Err("[toolchain.recovery] Unsafe uninstall directory".into())
            }
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    };
    if exists(&journal.tombstone)? {
        if journal.committed {
            parent
                .remove_dir_all(&journal.tombstone)
                .map_err(|e| e.to_string())?;
        } else {
            if exists(&journal.destination)? {
                return Err(
                    "[toolchain.recovery] Uninstall recovery conflict; data preserved".into(),
                );
            }
            parent
                .rename(&journal.tombstone, parent, &journal.destination)
                .map_err(|e| e.to_string())?;
        }
    } else if !journal.committed && !exists(&journal.destination)? {
        return Err("[toolchain.recovery] Uninstall recovery data is missing".into());
    }
    parent
        .remove_file(".aurona-uninstall.json")
        .map_err(|e| e.to_string())
}

fn commit_uninstall(parent: &cap_std::fs::Dir, destination: &str) -> Result<(), String> {
    recover_uninstall(parent)?;
    match parent.symlink_metadata(destination) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
        Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
            return Err("[toolchain.recovery] Unsafe uninstall target".into())
        }
        Ok(_) => {}
    }
    let mut journal = UninstallJournal {
        schema: 1,
        destination: destination.into(),
        tombstone: format!("uninstall-{:032x}", rand::random::<u128>()),
        committed: false,
    };
    let persist = |journal: &UninstallJournal| {
        crate::scoped_file::write(
            parent,
            Path::new(".aurona-uninstall.json"),
            &serde_json::to_vec(journal).map_err(|e| e.to_string())?,
        )
    };
    persist(&journal)?;
    let result = (|| {
        parent
            .rename(destination, parent, &journal.tombstone)
            .map_err(|e| e.to_string())?;
        journal.committed = true;
        persist(&journal)
    })();
    if let Err(error) = result {
        recover_uninstall(parent)
            .map_err(|recovery| format!("{error}; recovery failed: {recovery}"))?;
        return Err(error);
    }
    recover_uninstall(parent)
}

fn commit_install(
    parent: &cap_std::fs::Dir,
    destination: &str,
    stage: &str,
    backup: &str,
) -> Result<(), String> {
    let mut journal = InstallJournal {
        schema: 1,
        destination: destination.into(),
        stage: stage.into(),
        backup: backup.into(),
        had_previous: parent.symlink_metadata(destination).is_ok(),
        committed: false,
    };
    let persist = |journal: &InstallJournal| -> Result<(), String> {
        crate::scoped_file::write(
            parent,
            Path::new(".aurona-install.json"),
            &serde_json::to_vec(journal).map_err(|e| e.to_string())?,
        )
    };
    persist(&journal)?;
    let result = (|| {
        if journal.had_previous {
            parent
                .rename(destination, parent, backup)
                .map_err(|e| e.to_string())?;
        }
        parent
            .rename(stage, parent, destination)
            .map_err(|e| e.to_string())?;
        journal.committed = true;
        persist(&journal)
    })();
    if let Err(error) = result {
        // Failure before the durable commit marker rolls back to the previous installation.
        recover_install(parent)
            .map_err(|recovery| format!("{error}; recovery failed: {recovery}"))?;
        return Err(error);
    }
    recover_install(parent)
}

pub fn recover_interrupted_installs(app: &tauri::AppHandle) -> Result<(), String> {
    use cap_fs_ext::DirExt;
    let base = get_toolchains_base_dir(app)?;
    let root = cap_std::fs::Dir::open_ambient_dir(base, cap_std::ambient_authority())
        .map_err(|e| e.to_string())?;
    for kind in ["servers", "runtimes"] {
        let directory = match root.open_dir_nofollow(kind) {
            Ok(directory) => directory,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
        };
        recover_uninstall(&directory)?;
        for entry in directory.entries().map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                continue;
            }
            let parent = directory
                .open_dir_nofollow(entry.file_name())
                .map_err(|e| e.to_string())?;
            recover_install(&parent)?;
        }
    }
    Ok(())
}

impl Drop for InstallStagingDir {
    fn drop(&mut self) {
        if self.0.exists() {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

fn calculate_directory_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(meta) = p.symlink_metadata() else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                total += calculate_directory_size(&p);
            } else {
                total += meta.len();
            }
        }
    }
    total
}

fn indexed_directory_size(path: &Path) -> u64 {
    let index = path.join(".aurona-size.json");
    if let Ok(file) = File::open(&index) {
        if let Ok(size) = serde_json::from_reader::<_, u64>(file.take(128)) {
            return size;
        }
    }
    let size = calculate_directory_size(path);
    let _ = crate::atomic_store::replace(&index, size.to_string().as_bytes());
    size
}

fn runtime_binary_path(base: &Path, relative_path: &str) -> Option<PathBuf> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return None;
    }
    Some(base.join(relative))
}

fn installed_runtime_summary(
    directory_runtime_type: &str,
    directory_version: &str,
    install_path: &Path,
) -> InstalledRuntimeSummary {
    let manifest = fs::read_to_string(install_path.join("manifest.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<RuntimePackageManifest>(&content).ok());

    let runtime_type = manifest
        .as_ref()
        .map(|value| value.runtime_type.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(directory_runtime_type)
        .to_string();
    let version = manifest
        .as_ref()
        .map(|value| value.runtime_version.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(directory_version)
        .to_string();
    let configured_binary = manifest
        .as_ref()
        .and_then(|value| runtime_binary_path(install_path, &value.binary_path));
    let fallback_binary = if cfg!(windows) { "node.exe" } else { "node" };
    let effective_binary = configured_binary.unwrap_or_else(|| {
        let bin = install_path.join("bin").join(fallback_binary);
        if bin.exists() {
            bin
        } else {
            install_path.join(fallback_binary)
        }
    });

    InstalledRuntimeSummary {
        runtime_type,
        version,
        binary_path: effective_binary.to_string_lossy().to_string(),
        disk_size_bytes: indexed_directory_size(install_path),
    }
}

/// 在 APPDATA 共享运行时池中解析 Node.js 运行时可执行路径
pub fn find_shared_node_runtime(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let base = get_toolchains_base_dir(app_handle).ok()?;
    let runtimes_node = base.join("runtimes").join("node");
    let exe_name = if cfg!(windows) { "node.exe" } else { "node" };

    if runtimes_node.exists() {
        if let Ok(versions) = fs::read_dir(&runtimes_node) {
            for v_entry in versions.flatten() {
                let v_path = v_entry.path();
                if committed_version(&v_entry) {
                    // 候选路径 1: <version>/bin/node.exe
                    let bin_exe = v_path.join("bin").join(exe_name);
                    if bin_exe.is_file() {
                        return Some(bin_exe);
                    }
                    // 候选路径 2: <version>/node.exe
                    let root_exe = v_path.join(exe_name);
                    if root_exe.is_file() {
                        return Some(root_exe);
                    }
                }
            }
        }
    }

    None
}

/// 根据语言标识在 APPDATA 已安装语言服务池中查找对应 LSP
pub fn find_installed_lsp_for_language(
    app_handle: &tauri::AppHandle,
    language: &str,
) -> Option<(LspPackageManifest, PathBuf)> {
    let base = get_toolchains_base_dir(app_handle).ok()?;
    let servers_dir = base.join("servers");
    if !servers_dir.exists() {
        return None;
    }

    let target_lang = language.to_lowercase();

    if let Ok(servers) = fs::read_dir(&servers_dir) {
        for s_entry in servers.flatten() {
            let s_path = s_entry.path();
            if installed_family(&s_entry) {
                if let Ok(versions) = fs::read_dir(&s_path) {
                    for v_entry in versions.flatten() {
                        let v_path = v_entry.path();
                        if committed_version(&v_entry) {
                            let manifest_path = v_path.join("manifest.json");
                            if manifest_path.is_file() {
                                if let Ok(content) = fs::read_to_string(&manifest_path) {
                                    if let Ok(manifest) =
                                        serde_json::from_str::<LspPackageManifest>(&content)
                                    {
                                        if manifest
                                            .languages
                                            .iter()
                                            .any(|l| l.to_lowercase() == target_lang)
                                        {
                                            return Some((manifest, v_path));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

fn committed_version(entry: &fs::DirEntry) -> bool {
    semver::Version::parse(&entry.file_name().to_string_lossy()).is_ok()
        && entry
            .file_type()
            .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
        && !entry
            .path()
            .parent()
            .is_some_and(|parent| parent.join(".aurona-install.json").exists())
}

fn installed_family(entry: &fs::DirEntry) -> bool {
    let name = entry.file_name();
    let name = name.to_string_lossy();
    !name.starts_with("uninstall-")
        && validate_toolchain_segment(&name).is_ok()
        && entry
            .file_type()
            .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainProgressPayload {
    pub download_id: String,
    pub stage: String, // "downloading" | "extracting" | "completed" | "failed"
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub message: Option<String>,
}

/// 从本地文件流式解压安装 LSP 语言服务包或共享运行时包（0 内存峰值）
pub(crate) fn install_toolchain_file_cancellable(
    app_handle: &tauri::AppHandle,
    file_path: &Path,
    expected_sha256: Option<&str>,
    cancel: Option<&std::sync::atomic::AtomicBool>,
    signed: Option<&crate::artifact_signature::ArtifactPayload>,
    generation: u64,
) -> Result<InstalledToolchainSummary, String> {
    let workspace = app_handle.state::<crate::commands::fs::WorkspaceState>();
    let check = || -> Result<(), String> {
        check_cancel(cancel)?;
        if workspace.generation() != generation {
            return Err(
                "[workspace.generation] Workspace changed during toolchain installation".into(),
            );
        }
        Ok(())
    };
    check()?;
    let mut file = File::open(file_path).map_err(|e| format!("打开安装包文件失败: {e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > crate::resource_limits::DOWNLOAD_BYTES {
        return Err("[resource.limit] Toolchain package exceeds 1 GiB".into());
    }
    if signed.is_some_and(|payload| {
        file.metadata()
            .map_or(true, |metadata| metadata.len() != payload.size_bytes)
    }) {
        return Err("[signature.size] Toolchain artifact size changed before installation".into());
    }

    // 1. SHA-256 校验
    if let Some(expected) = expected_sha256 {
        let expected_clean = expected.trim().to_lowercase();
        if !expected_clean.is_empty() {
            let mut hasher = Sha256::new();
            let check_file = &mut file;
            let mut buf = [0u8; 64 * 1024];
            let mut size = 0u64;
            loop {
                check()?;
                let n = check_file
                    .read(&mut buf)
                    .map_err(|e| format!("读取文件校验哈希失败: {e}"))?;
                if n == 0 {
                    break;
                }
                size = size.saturating_add(n as u64);
                if size > crate::resource_limits::DOWNLOAD_BYTES {
                    return Err("[resource.limit] Toolchain package grew beyond 1 GiB".into());
                }
                hasher.update(&buf[..n]);
            }
            let actual = format!("{:x}", hasher.finalize());
            if signed.is_some_and(|payload| size != payload.size_bytes) {
                return Err("[signature.size] Toolchain artifact changed while hashing".into());
            }
            if actual != expected_clean {
                return Err(format!(
                    "SHA-256 校验未通过：期望 {expected_clean}，实际计算为 {actual}。安装已被安全中止"
                ));
            }
            use std::io::Seek;
            file.rewind().map_err(|e| e.to_string())?;
        }
    }

    let mut zip = ZipArchive::new(file).map_err(|e| format!("无法解压归档包: {e}"))?;
    let declared = archive_preflight(&mut zip, check)?;

    // 2. 读取 manifest.json
    let manifest_bytes = {
        let mut f = zip
            .by_name("manifest.json")
            .map_err(|_| "安装包根目录缺少 manifest.json 清单文件".to_string())?;
        let mut buf = Vec::new();
        (&mut f)
            .take(1024 * 1024 + 1)
            .read_to_end(&mut buf)
            .map_err(|e| format!("读取 manifest.json 失败: {e}"))?;
        if buf.len() > 1024 * 1024 {
            return Err("[resource.limit] Toolchain manifest exceeds 1 MiB".into());
        }
        buf
    };

    let manifest_val: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("manifest.json 格式错误: {e}"))?;

    let kind = manifest_val
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("lsp")
        .to_lowercase();

    let id = manifest_val
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "manifest.json 缺少 id".to_string())?;

    let version = manifest_val
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("1.0.0");

    validate_toolchain_segment(id)?;
    validate_toolchain_segment(version)?;
    semver::Version::parse(version).map_err(|_| "[toolchain.version] Invalid package version")?;
    if !matches!(kind.as_str(), "runtime" | "lsp") {
        return Err("[toolchain.kind] Unsupported package kind".into());
    }
    if let Some(payload) = signed {
        validate_signed_toolchain(payload, &manifest_val)?;
    }
    let resource_id = if kind == "runtime" {
        format!(
            "runtime:{}",
            manifest_val
                .get("runtimeType")
                .and_then(|v| v.as_str())
                .unwrap_or("node")
        )
    } else {
        format!("server:{id}")
    };
    let lock = mutation_lock(&resource_id)?;
    let _mutation = loop {
        check()?;
        match lock.try_lock() {
            Ok(guard) => break guard,
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(std::time::Duration::from_millis(10))
            }
            Err(_) => return Err("[toolchain.state] Task coordinator unavailable".into()),
        }
    };
    let _use = exclusive_use(&resource_id)?;

    let base = get_toolchains_base_dir(app_handle)?;

    let install_dir = if kind == "runtime" {
        let r_type = manifest_val
            .get("runtimeType")
            .and_then(|v| v.as_str())
            .unwrap_or("node");
        let runtimes = checked_child_directory(&base, "runtimes", true)?;
        let runtime = checked_child_directory(&runtimes, r_type, true)?;
        checked_child_directory(&runtime, version, false)?
    } else {
        let servers = checked_child_directory(&base, "servers", true)?;
        let server = checked_child_directory(&servers, id, true)?;
        checked_child_directory(&server, version, false)?
    };

    let install_parent = install_dir
        .parent()
        .ok_or_else(|| "Invalid toolchain install directory".to_string())?;
    let parent_handle =
        cap_std::fs::Dir::open_ambient_dir(install_parent, cap_std::ambient_authority())
            .map_err(|e| e.to_string())?;
    recover_install(&parent_handle)?;
    let staging_name = format!("stage-{}-{}", std::process::id(), rand::random::<u64>());
    let target_dir = checked_child_directory(install_parent, &staging_name, true)?;
    let _staging_guard = InstallStagingDir(target_dir.clone());

    // 清理旧版本目录并重建
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("无法创建目标目录 {}: {e}", target_dir.display()))?;

    // 3. 安全解压文件 (防 ZipSlip 越界)
    let mut expanded = 0u64;
    reserve_space(&target_dir, declared)?;
    let mut last_space_check = 0u64;
    let mut names = std::collections::HashSet::new();
    for i in 0..zip.len() {
        check()?;
        let mut f = zip
            .by_index(i)
            .map_err(|e| format!("读取文件条目异常: {e}"))?;
        let rel_path = f
            .enclosed_name()
            .ok_or_else(|| "包内包含潜在逃逸危险路径".to_string())?
            .to_owned();

        let out_path = target_dir.join(&rel_path);
        if !names.insert(rel_path.to_string_lossy().to_ascii_lowercase()) {
            return Err("[archive.duplicate] Duplicate archive path".into());
        }
        if f.unix_mode()
            .is_some_and(|mode| !matches!(mode & 0o170000, 0 | 0o100000 | 0o040000))
        {
            return Err("[archive.special_file] Links and special files are prohibited".into());
        }
        if f.size() > crate::resource_limits::EXPANDED_ENTRY_BYTES
            || f.size()
                > f.compressed_size()
                    .max(1)
                    .saturating_mul(crate::resource_limits::COMPRESSION_RATIO)
            || expanded.saturating_add(f.size()) > crate::resource_limits::EXPANDED_BYTES
        {
            return Err("[archive.expansion_limit] Archive exceeds extraction budget".into());
        }
        if f.name().ends_with('/') || f.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if expanded.saturating_sub(last_space_check) >= 64 * 1024 * 1024 {
                reserve_space(&target_dir, declared.saturating_sub(expanded))?;
                last_space_check = expanded;
            }
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&out_path)
                .map_err(|e| format!("创建文件失败 {}: {e}", out_path.display()))?;
            let mut written = 0u64;
            let mut chunk = [0u8; 256 * 1024];
            loop {
                check()?;
                let count = f.read(&mut chunk).map_err(|e| e.to_string())?;
                if count == 0 {
                    break;
                }
                written += count as u64;
                if written > f.size()
                    || expanded.saturating_add(written) > crate::resource_limits::EXPANDED_BYTES
                {
                    return Err(
                        "[archive.expansion_limit] Actual extraction exceeds declared budget"
                            .into(),
                    );
                }
                outfile
                    .write_all(&chunk[..count])
                    .map_err(|e| e.to_string())?;
            }
            outfile.sync_all().map_err(|e| e.to_string())?;
            expanded = expanded.saturating_add(written);
            if written != f.size() || expanded > crate::resource_limits::EXPANDED_BYTES {
                return Err(
                    "[archive.expansion_limit] Actual extraction exceeds declared budget".into(),
                );
            }
        }
    }

    // 4. 自动兼容修补 pyright 内部相对路径问题
    let index_cjs = target_dir.join("dist").join("langserver.index.cjs");
    if index_cjs.is_file() {
        if let Ok(content) = fs::read_to_string(&index_cjs) {
            if content.contains("require('./dist/pyright-langserver')") {
                let fixed = content.replace(
                    "require('./dist/pyright-langserver')",
                    "try { require('./pyright-langserver'); } catch (e) { require('./dist/pyright-langserver'); }",
                );
                let _ = fs::write(&index_cjs, fixed);
            }
        }
    }

    #[cfg(unix)]
    {
        if kind == "runtime" {
            use std::os::unix::fs::PermissionsExt;
            let bin_dir = target_dir.join("bin");
            if bin_dir.exists() {
                if let Ok(entries) = fs::read_dir(bin_dir) {
                    for entry in entries.flatten() {
                        let _ =
                            fs::set_permissions(entry.path(), fs::Permissions::from_mode(0o755));
                    }
                }
            }
        }
    }

    let disk_size = calculate_directory_size(&target_dir);
    crate::atomic_store::replace(
        &target_dir.join(".aurona-size.json"),
        disk_size.to_string().as_bytes(),
    )?;
    check()?;
    let name = manifest_val
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(id)
        .to_string();

    let languages = manifest_val
        .get("languages")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let runtime_type = manifest_val
        .get("runtime")
        .and_then(|r| r.get("type"))
        .and_then(|t| t.as_str())
        .unwrap_or("node")
        .to_string();

    let backup_name = format!("backup-{}-{}", std::process::id(), rand::random::<u64>());
    workspace.with_generation(generation, || {
        check_cancel(cancel)?;
        commit_install(&parent_handle, version, &staging_name, &backup_name)
    })?;

    Ok(InstalledToolchainSummary {
        id: id.to_string(),
        name,
        version: version.to_string(),
        languages,
        runtime_type,
        install_path: install_dir.to_string_lossy().to_string(),
        disk_size_bytes: disk_size,
    })
}

/// 异步流式下载并安装 LSP 或共享运行时（原生流式落盘，进度精确广播，零内存压力）
pub async fn install_toolchain_from_url(
    app_handle: tauri::AppHandle,
    download_id: String,
    url: String,
    expected_sha256: Option<String>,
    expected_id: String,
    expected_version: Option<String>,
) -> Result<crate::artifacts::ArtifactHandle, String> {
    use tauri::Emitter;
    use tokio::io::AsyncWriteExt;

    let task_state = app_handle.state::<crate::tasks::TaskState>();
    let workspace = app_handle.state::<crate::commands::fs::WorkspaceState>();
    let generation = workspace.generation();
    let task = task_state.begin(&download_id)?;

    let _permit = tokio::select! {
        biased;
        _ = task.cancelled() => return Err("[task.cancelled] Download cancelled".into()),
        permit = crate::resource_limits::DOWNLOADS.acquire() => permit.map_err(|_| "[download.closed] Download queue closed")?,
    };
    let mut res = tokio::select! {
        biased;
        _ = task.cancelled() => return Err("[task.cancelled] Download cancelled".into()),
        result = crate::network_policy::download_response(&url, crate::network_policy::DownloadPurpose::Toolchain) => result?,
    };
    if !res.status().is_success() {
        return Err(format!("下载响应错误: HTTP {}", res.status()));
    }
    use base64::Engine;
    let source = crate::network_policy::validate_download_url(
        &url,
        crate::network_policy::DownloadPurpose::Toolchain,
    )?
    .origin()
    .ascii_serialization();
    let descriptor = res
        .headers()
        .get("X-Aurona-Artifact-Descriptor")
        .and_then(|value| value.to_str().ok())
        .ok_or("[signature.required] Remote toolchains require a signed artifact descriptor")?;
    if descriptor.len() > 16 * 1024 {
        return Err("[resource.limit] Toolchain signature descriptor exceeds limit".into());
    }
    let signed: crate::artifact_signature::SignedArtifact = serde_json::from_slice(
        &base64::engine::general_purpose::STANDARD
            .decode(descriptor)
            .map_err(|_| "[signature.schema] Invalid toolchain descriptor encoding")?,
    )
    .map_err(|_| "[signature.schema] Invalid toolchain descriptor")?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let version = expected_version
        .as_deref()
        .unwrap_or(&signed.payload.version);
    let platform = if signed.payload.platform == "any" {
        "any"
    } else {
        host_artifact_platform()
    };
    crate::artifact_signature::verify(
        &signed,
        &crate::artifact_signature::trusted_keys()?,
        &expected_id,
        version,
        platform,
        &source,
        crate::marketplace_catalog::installation_revision(
            &app_handle,
            &source,
            &expected_id,
            version,
        )?,
        now,
    )?;
    if expected_sha256
        .as_ref()
        .is_some_and(|hash| !hash.eq_ignore_ascii_case(&signed.payload.sha256))
    {
        return Err("[signature.hash] Requested hash differs from signed toolchain".into());
    }

    let total_bytes = res.content_length().unwrap_or(0);
    if total_bytes > crate::resource_limits::DOWNLOAD_BYTES {
        return Err("[download.size_limit] Package exceeds 1 GiB".into());
    }
    if res
        .content_length()
        .is_some_and(|size| size != signed.payload.size_bytes)
    {
        return Err("[signature.size] Toolchain length differs from signed metadata".into());
    }

    // 2. 创建临时文件
    let temp = tempfile::Builder::new()
        .prefix("aurona-download-")
        .tempfile()
        .map_err(|e| e.to_string())?;
    let mut dest = tokio::fs::File::from_std(temp.reopen().map_err(|e| e.to_string())?);

    // 3. 流式写入与进度派发
    let mut downloaded_bytes = 0u64;
    let mut last_emit = std::time::Instant::now();

    loop {
        let chunk = tokio::select! {
            biased;
            _ = task.cancelled() => return Err("[task.cancelled] Download cancelled".into()),
            result = res.chunk() => result.map_err(|_| "[download.stream] Download stream failed")?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        if downloaded_bytes.saturating_add(chunk.len() as u64) > signed.payload.size_bytes {
            return Err("[download.size_limit] Actual package exceeds 1 GiB".into());
        }
        dest.write_all(&chunk)
            .await
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        downloaded_bytes += chunk.len() as u64;

        if last_emit.elapsed().as_millis() > 60 || downloaded_bytes == total_bytes {
            last_emit = std::time::Instant::now();
            let percentage = if total_bytes > 0 {
                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            };

            let _ = app_handle.emit(
                "toolchain://download_progress",
                ToolchainProgressPayload {
                    download_id: download_id.clone(),
                    stage: "downloading".to_string(),
                    downloaded_bytes,
                    total_bytes,
                    percentage,
                    message: Some(format!(
                        "已下载 {:.1} MB / {:.1} MB",
                        downloaded_bytes as f64 / 1_048_576.0,
                        total_bytes as f64 / 1_048_576.0
                    )),
                },
            );
        }
    }

    dest.flush().await.map_err(|e| e.to_string())?;
    dest.sync_all().await.map_err(|e| e.to_string())?;
    drop(dest);
    if downloaded_bytes != signed.payload.size_bytes {
        return Err("[signature.size] Toolchain length differs from signed metadata".into());
    }

    let expected = signed.payload.sha256.clone();
    let expected_size = signed.payload.size_bytes;
    let cancelled = task.flag();
    let sha256 = tokio::task::spawn_blocking(move || {
        let mut reader = temp.reopen().map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut size = 0u64;
        let mut bytes = [0u8; 256 * 1024];
        loop {
            check_cancel(Some(&cancelled))?;
            let count = reader.read(&mut bytes).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            size = size.saturating_add(count as u64);
            if size > crate::resource_limits::DOWNLOAD_BYTES {
                return Err("[resource.limit] Toolchain artifact exceeds 1 GiB".into());
            }
            hash.update(&bytes[..count]);
        }
        if size != expected_size || format!("{:x}", hash.finalize()) != expected {
            return Err("[signature.hash] Toolchain artifact does not match signed hash".into());
        }
        Ok::<_, String>(temp)
    })
    .await
    .map_err(|e| e.to_string())??;
    check_cancel(Some(&task.flag()))?;
    if workspace.generation() != generation {
        return Err("[workspace.generation] Workspace changed during toolchain download".into());
    }
    app_handle
        .state::<crate::artifacts::ArtifactState>()
        .register_toolchain(sha256, signed.payload, generation)
}

fn host_artifact_platform() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "windows-x86_64"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "linux-x86_64"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "darwin-aarch64"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "darwin-x86_64"
    } else {
        "unsupported"
    }
}

fn validate_signed_toolchain(
    payload: &crate::artifact_signature::ArtifactPayload,
    manifest: &serde_json::Value,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    if manifest.get("id").and_then(serde_json::Value::as_str) != Some(&payload.extension_id)
        || manifest.get("version").and_then(serde_json::Value::as_str) != Some(&payload.version)
        || payload.expires_at <= now
        || (payload.platform == "any"
            && (manifest.get("kind").and_then(serde_json::Value::as_str) != Some("lsp")
                || manifest
                    .pointer("/runtime/type")
                    .and_then(serde_json::Value::as_str)
                    != Some("node")))
    {
        return Err(
            "[signature.manifest] Toolchain identity or platform differs from signed metadata"
                .into(),
        );
    }
    Ok(())
}

/// 列出本地 APPDATA 已安装的所有工具链与共享运行时
pub fn list_all_installed_toolchains(app_handle: &tauri::AppHandle) -> ToolchainsOverview {
    let mut servers_res = Vec::new();
    let mut runtimes_res = Vec::new();

    let Ok(base) = get_toolchains_base_dir(app_handle) else {
        return ToolchainsOverview {
            servers: Vec::new(),
            runtimes: Vec::new(),
            total_bytes: 0,
        };
    };

    // 扫描 servers
    let servers_dir = base.join("servers");
    if servers_dir.exists() {
        if let Ok(s_entries) = fs::read_dir(&servers_dir) {
            for s_entry in s_entries.flatten() {
                let s_path = s_entry.path();
                if installed_family(&s_entry) {
                    if let Ok(v_entries) = fs::read_dir(&s_path) {
                        for v_entry in v_entries.flatten() {
                            let v_path = v_entry.path();
                            if committed_version(&v_entry) {
                                let manifest_p = v_path.join("manifest.json");
                                if manifest_p.is_file() {
                                    if let Ok(content) = fs::read_to_string(&manifest_p) {
                                        if let Ok(m) =
                                            serde_json::from_str::<LspPackageManifest>(&content)
                                        {
                                            let size = indexed_directory_size(&v_path);
                                            servers_res.push(InstalledToolchainSummary {
                                                id: m.id,
                                                name: m.name,
                                                version: m.version,
                                                languages: m.languages,
                                                runtime_type: m.runtime.runtime_type,
                                                install_path: v_path.to_string_lossy().to_string(),
                                                disk_size_bytes: size,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 扫描 runtimes
    let runtimes_dir = base.join("runtimes");
    if runtimes_dir.exists() {
        if let Ok(r_entries) = fs::read_dir(&runtimes_dir) {
            for r_entry in r_entries.flatten() {
                let r_path = r_entry.path();
                if installed_family(&r_entry) {
                    let r_type = r_entry.file_name().to_string_lossy().to_string();
                    if let Ok(v_entries) = fs::read_dir(&r_path) {
                        for v_entry in v_entries.flatten() {
                            let v_path = v_entry.path();
                            if committed_version(&v_entry) {
                                let v_name = v_entry.file_name().to_string_lossy().to_string();
                                runtimes_res
                                    .push(installed_runtime_summary(&r_type, &v_name, &v_path));
                            }
                        }
                    }
                }
            }
        }
    }

    let total = servers_res.iter().map(|s| s.disk_size_bytes).sum::<u64>()
        + runtimes_res.iter().map(|r| r.disk_size_bytes).sum::<u64>();

    ToolchainsOverview {
        servers: servers_res,
        runtimes: runtimes_res,
        total_bytes: total,
    }
}

/// 卸载指定的 LSP 语言服务
pub fn uninstall_toolchain_server(app_handle: &tauri::AppHandle, id: &str) -> Result<(), String> {
    validate_toolchain_segment(id)?;
    let lock = mutation_lock(&format!("server:{id}"))?;
    let _mutation = lock
        .lock()
        .map_err(|_| "[toolchain.state] Task coordinator unavailable")?;
    let _use = exclusive_use(&format!("server:{id}"))?;
    let uninstall_lock = mutation_lock("uninstall:servers")?;
    let _uninstall = uninstall_lock
        .lock()
        .map_err(|_| "[toolchain.state] Uninstall coordinator unavailable")?;
    let base = get_toolchains_base_dir(app_handle)?;
    let servers = checked_child_directory(&base, "servers", false)?;
    if !servers.exists() {
        return Ok(());
    }
    let parent = cap_std::fs::Dir::open_ambient_dir(&servers, cap_std::ambient_authority())
        .map_err(|e| e.to_string())?;
    commit_uninstall(&parent, id)
}

/// 清理/卸载指定的共享运行时
pub fn uninstall_toolchain_runtime(
    app_handle: &tauri::AppHandle,
    runtime_type: &str,
) -> Result<(), String> {
    validate_toolchain_segment(runtime_type)?;
    let lock = mutation_lock(&format!("runtime:{runtime_type}"))?;
    let _mutation = lock
        .lock()
        .map_err(|_| "[toolchain.state] Task coordinator unavailable")?;
    let _use = exclusive_use(&format!("runtime:{runtime_type}"))?;
    let uninstall_lock = mutation_lock("uninstall:runtimes")?;
    let _uninstall = uninstall_lock
        .lock()
        .map_err(|_| "[toolchain.state] Uninstall coordinator unavailable")?;
    let base = get_toolchains_base_dir(app_handle)?;
    let runtimes = checked_child_directory(&base, "runtimes", false)?;
    if !runtimes.exists() {
        return Ok(());
    }
    let parent = cap_std::fs::Dir::open_ambient_dir(&runtimes, cap_std::ambient_authority())
        .map_err(|e| e.to_string())?;
    commit_uninstall(&parent, runtime_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive_fixture(entries: &[(&str, &[u8])], compressed: bool) -> Vec<u8> {
        use zip::write::SimpleFileOptions;
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(if compressed {
            zip::CompressionMethod::Deflated
        } else {
            zip::CompressionMethod::Stored
        });
        for (name, bytes) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn archive_preflight_rejects_bombs_paths_duplicates_links_and_cancellation() {
        for name in [
            "../escape",
            "/escape",
            "C:/escape",
            "nested\\escape",
            "a/../escape",
            "file:stream",
            "trailing.",
        ] {
            let bytes = archive_fixture(&[(name, b"data")], false);
            let mut zip = ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
            assert!(
                archive_preflight(&mut zip, || Ok(()))
                    .unwrap_err()
                    .contains("archive.path"),
                "{name}"
            );
        }
        let bytes = archive_fixture(&[("File", b"a"), ("file", b"b")], false);
        let mut zip = ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        assert!(archive_preflight(&mut zip, || Ok(()))
            .unwrap_err()
            .contains("archive.duplicate"));
        let bomb = vec![0; 1024 * 1024];
        let bytes = archive_fixture(&[("bomb", &bomb)], true);
        let mut zip = ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        assert!(archive_preflight(&mut zip, || Ok(()))
            .unwrap_err()
            .contains("archive.expansion_limit"));
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        writer
            .add_symlink(
                "link",
                "../outside",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        let mut zip =
            ZipArchive::new(std::io::Cursor::new(writer.finish().unwrap().into_inner())).unwrap();
        assert!(archive_preflight(&mut zip, || Ok(()))
            .unwrap_err()
            .contains("archive.special_file"));
        let bytes = archive_fixture(&[("manifest.json", b"{}"), ("bin/tool", b"normal")], false);
        let mut zip = ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(archive_preflight(&mut zip, || Ok(())).unwrap(), 8);
        assert!(
            archive_preflight(&mut zip, || Err("[task.cancelled] cancelled".into()))
                .unwrap_err()
                .contains("task.cancelled")
        );
    }

    #[test]
    fn archive_space_budget_preserves_the_required_margin_and_handles_overflow() {
        assert!(validate_available_space(512 * 1024 * 1024 + 99, 100).is_err());
        assert!(validate_available_space(512 * 1024 * 1024 + 100, 100).is_ok());
        assert!(validate_available_space(u64::MAX - 1, u64::MAX).is_err());
    }

    #[test]
    fn uncommitted_versions_never_become_launch_candidates() {
        let root = tempfile::tempdir().unwrap();
        for name in ["1.0.0", "stage-1", "backup-1", "uninstall-1"] {
            fs::create_dir(root.path().join(name)).unwrap();
        }
        let candidates = || {
            fs::read_dir(root.path())
                .unwrap()
                .flatten()
                .filter(committed_version)
                .count()
        };
        assert_eq!(candidates(), 1);
        fs::write(root.path().join(".aurona-install.json"), b"pending").unwrap();
        assert_eq!(candidates(), 0);
    }

    #[test]
    fn signed_toolchains_bind_manifest_identity_and_portable_platform() {
        let mut payload = crate::artifact_signature::ArtifactPayload {
            schema_version: 1,
            publisher: "test".into(),
            extension_id: "test.lsp".into(),
            version: "1.0.0".into(),
            platform: "any".into(),
            sha256: "0".repeat(64),
            size_bytes: 1,
            source: "https://marketplace.aurona.cc".into(),
            issued_at: 0,
            expires_at: u64::MAX,
            catalog_revision: 1,
        };
        let manifest = serde_json::json!({"id":"test.lsp", "version":"1.0.0", "kind":"lsp", "runtime":{"type":"node"}});
        assert!(validate_signed_toolchain(&payload, &manifest).is_ok());
        for field in ["id", "version", "kind"] {
            let mut changed = manifest.clone();
            changed[field] = serde_json::json!("other");
            assert!(validate_signed_toolchain(&payload, &changed).is_err());
        }
        payload.expires_at = 1;
        assert!(validate_signed_toolchain(&payload, &manifest).is_err());
    }

    #[test]
    fn uninstall_recovers_precommit_and_finishes_committed_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let parent =
            cap_std::fs::Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        for committed in [false, true] {
            parent.create_dir("fixture").unwrap();
            parent.write("fixture/keep", b"original").unwrap();
            let journal = UninstallJournal {
                schema: 1,
                destination: "fixture".into(),
                tombstone: "uninstall-fixture".into(),
                committed,
            };
            parent
                .write(
                    ".aurona-uninstall.json",
                    serde_json::to_vec(&journal).unwrap(),
                )
                .unwrap();
            parent
                .rename("fixture", &parent, "uninstall-fixture")
                .unwrap();
            recover_uninstall(&parent).unwrap();
            assert!(!root.path().join("uninstall-fixture").exists());
            if !committed {
                assert_eq!(parent.read("fixture/keep").unwrap(), b"original");
                commit_uninstall(&parent, "fixture").unwrap();
            }
            assert!(!root.path().join("fixture").exists());
            assert!(!root.path().join(".aurona-uninstall.json").exists());
        }
    }

    #[test]
    fn running_tool_leases_block_mutation_and_release_across_one_hundred_cycles() {
        for cycle in 0..100 {
            let id = format!("server:fixture-{cycle}");
            let reader = use_lock(&id).unwrap().try_read_owned().unwrap();
            assert!(exclusive_use(&id).is_err());
            drop(reader);
            let writer = exclusive_use(&id).unwrap();
            assert!(use_lock(&id).unwrap().try_read_owned().is_err());
            drop(writer);
            assert!(use_lock(&id).unwrap().try_read_owned().is_ok());
        }
    }

    #[test]
    fn install_journal_recovers_before_and_after_directory_switch() {
        let root = tempfile::tempdir().unwrap();
        let parent =
            cap_std::fs::Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        for moved_stage in [false, true] {
            parent.create_dir("1.0.0").unwrap();
            parent.write("1.0.0/version", b"old").unwrap();
            parent.create_dir("stage-1").unwrap();
            parent.write("stage-1/version", b"new").unwrap();
            let journal = InstallJournal {
                schema: 1,
                destination: "1.0.0".into(),
                stage: "stage-1".into(),
                backup: "backup-1".into(),
                had_previous: true,
                committed: false,
            };
            parent
                .write(
                    ".aurona-install.json",
                    serde_json::to_vec(&journal).unwrap(),
                )
                .unwrap();
            parent.rename("1.0.0", &parent, "backup-1").unwrap();
            if moved_stage {
                parent.rename("stage-1", &parent, "1.0.0").unwrap();
            }
            recover_install(&parent).unwrap();
            assert_eq!(parent.read("1.0.0/version").unwrap(), b"old");
            assert_eq!(parent.entries().unwrap().count(), 1);
            parent.remove_dir_all("1.0.0").unwrap();
        }
    }

    #[test]
    fn one_hundred_install_switches_leave_only_the_committed_version() {
        let root = tempfile::tempdir().unwrap();
        let parent =
            cap_std::fs::Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        for cycle in 0..100 {
            parent.create_dir("stage-1").unwrap();
            parent.write("stage-1/version", cycle.to_string()).unwrap();
            commit_install(&parent, "1.0.0", "stage-1", "backup-1").unwrap();
            assert_eq!(
                parent.read_to_string("1.0.0/version").unwrap(),
                cycle.to_string()
            );
            assert_eq!(parent.entries().unwrap().count(), 1);
        }
    }

    #[test]
    fn toolchain_path_segments_reject_traversal_and_absolute_paths() {
        for value in [
            "",
            ".",
            "..",
            "../outside",
            "..\\outside",
            "/outside",
            "C:\\outside",
            "a..b",
        ] {
            assert!(validate_toolchain_segment(value).is_err(), "{value}");
        }
        for value in [
            "auronalabs.pyright",
            "0.4.0-pioneer.2",
            "1.2.3+build.4",
            "node_22",
        ] {
            assert!(validate_toolchain_segment(value).is_ok(), "{value}");
        }
    }

    #[test]
    fn installed_runtime_summary_reads_the_local_manifest() {
        let directory = std::env::temp_dir().join(format!(
            "aurona-runtime-summary-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::create_dir_all(directory.join("bin")).unwrap();
        std::fs::write(
            directory.join("manifest.json"),
            r#"{
              "schemaVersion": 1,
              "kind": "runtime",
              "id": "auronalabs.runtime-bun",
              "version": "1.1.0",
              "runtimeType": "bun",
              "runtimeVersion": "1.1.0",
              "binaryPath": "bin/bun"
            }"#,
        )
        .unwrap();
        std::fs::write(directory.join("bin").join("bun"), b"runtime").unwrap();

        let summary = installed_runtime_summary("node", "directory-version", &directory);

        assert_eq!(summary.runtime_type, "bun");
        assert_eq!(summary.version, "1.1.0");
        assert!(Path::new(&summary.binary_path).ends_with(Path::new("bin").join("bun")));
        assert!(summary.disk_size_bytes > 0);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn runtime_manifest_cannot_escape_its_install_directory() {
        assert!(runtime_binary_path(Path::new("runtime"), "../outside").is_none());
    }
}
