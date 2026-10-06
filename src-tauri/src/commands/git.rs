use crate::commands::fs::WorkspaceState;
use cap_fs_ext::DirExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock, Weak};
use tauri::Manager;
use ts_rs::TS;

struct GitRunContext {
    app: tauri::AppHandle,
    generation: u64,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}
thread_local! {
    static RUN_CONTEXT: std::cell::RefCell<Option<GitRunContext>> = const { std::cell::RefCell::new(None) };
}
struct RunContextGuard;
impl Drop for RunContextGuard {
    fn drop(&mut self) {
        RUN_CONTEXT.with(|context| context.borrow_mut().take());
    }
}
type GitStatusCell = Arc<tokio::sync::OnceCell<Result<GitFullStatus, String>>>;
fn run_cancelled() -> bool {
    RUN_CONTEXT.with(|context| {
        context.borrow().as_ref().is_some_and(|context| {
            context.cancelled.load(std::sync::atomic::Ordering::Acquire)
                || context.app.state::<WorkspaceState>().generation() != context.generation
        })
    })
}

#[derive(Default)]
pub struct GitState {
    repositories: Mutex<HashMap<std::path::PathBuf, Weak<RwLock<()>>>>,
    active: Mutex<HashMap<std::path::PathBuf, Vec<Weak<std::sync::atomic::AtomicBool>>>>,
    statuses: tokio::sync::Mutex<HashMap<(String, u64), GitStatusCell>>,
}

impl GitState {
    fn repository_lock(&self, root: &Path) -> Result<Arc<RwLock<()>>, String> {
        let mut repositories = self
            .repositories
            .lock()
            .map_err(|_| "[git.lock] Repository registry unavailable")?;
        repositories.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = repositories.get(root).and_then(Weak::upgrade) {
            return Ok(lock);
        }
        if repositories.len() >= 64 {
            return Err("[resource.limit] Git repository limit reached".into());
        }
        let lock = Arc::new(RwLock::new(()));
        repositories.insert(root.to_owned(), Arc::downgrade(&lock));
        Ok(lock)
    }
}

async fn run_scoped<T: Send + 'static>(
    app: tauri::AppHandle,
    path: String,
    mutation: bool,
    work: impl FnOnce(String) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    run_scoped_target(app, path, mutation, false, work).await
}

fn authorized_repository_root(
    workspace: &WorkspaceState,
    cwd: &Path,
    initialize: bool,
) -> Result<std::path::PathBuf, String> {
    if initialize {
        match std::fs::symlink_metadata(cwd.join(".git")) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(cwd.to_owned()),
            Err(error) => return Err(error.to_string()),
            Ok(_) => {}
        }
    }
    let output = git_output(
        &cwd.to_string_lossy(),
        &["rev-parse", "--show-toplevel", "--absolute-git-dir"],
    )?;
    if !output.status.success() {
        return Ok(cwd.to_owned());
    }
    let output = String::from_utf8_lossy(&output.stdout);
    let mut lines = output.lines();
    let repository = Path::new(
        lines
            .next()
            .ok_or("[git.repository] Missing repository root")?,
    )
    .canonicalize()
    .map_err(|e| e.to_string())?;
    workspace.require_directory(&repository.to_string_lossy())?;
    let git_dir = Path::new(
        lines
            .next()
            .ok_or("[git.repository] Missing Git directory")?,
    )
    .canonicalize()
    .map_err(|e| e.to_string())?;
    if !git_dir.starts_with(&repository) {
        workspace.require_directory(&git_dir.to_string_lossy())?;
    }
    Ok(repository)
}

async fn run_scoped_target<T: Send + 'static>(
    app: tauri::AppHandle,
    path: String,
    mutation: bool,
    initialize: bool,
    work: impl FnOnce(String) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let workspace = app.state::<WorkspaceState>();
    let generation = workspace.generation();
    let cwd = workspace.require_directory(&path)?;
    if workspace.contains(&cwd.to_string_lossy())? {
        workspace.validate_path(&cwd.to_string_lossy(), true)?;
    }
    tokio::task::spawn_blocking(move || {
        let workspace = app.state::<WorkspaceState>();
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        {
            let state = app.state::<GitState>();
            let mut active = state
                .active
                .lock()
                .map_err(|_| "[git.lock] Cancellation registry unavailable")?;
            active.retain(|_, flags| {
                flags.retain(|flag| flag.strong_count() > 0);
                !flags.is_empty()
            });
            if active.values().map(Vec::len).sum::<usize>() >= 64 {
                return Err("[resource.limit] Too many Git operations".into());
            }
            active
                .entry(cwd.clone())
                .or_default()
                .push(Arc::downgrade(&cancelled));
        }
        RUN_CONTEXT.with(|context| {
            *context.borrow_mut() = Some(GitRunContext {
                app: app.clone(),
                generation,
                cancelled,
            })
        });
        let _context = RunContextGuard;
        if workspace.generation() != generation {
            return Err("[workspace.generation] Workspace changed before Git operation".into());
        }
        let lock_root = authorized_repository_root(&workspace, &cwd, initialize)?;
        let lock = app.state::<GitState>().repository_lock(&lock_root)?;
        let read_guard;
        let write_guard;
        if mutation {
            write_guard = Some(loop {
                if run_cancelled() {
                    return Err("[git.cancelled] Git operation cancelled while queued".into());
                }
                match lock.try_write() {
                    Ok(guard) => break guard,
                    Err(std::sync::TryLockError::WouldBlock) => {
                        std::thread::sleep(std::time::Duration::from_millis(10))
                    }
                    Err(_) => return Err("[git.lock] Repository lock unavailable".into()),
                }
            });
            read_guard = None;
        } else {
            read_guard = Some(loop {
                if run_cancelled() {
                    return Err("[git.cancelled] Git operation cancelled while queued".into());
                }
                match lock.try_read() {
                    Ok(guard) => break guard,
                    Err(std::sync::TryLockError::WouldBlock) => {
                        std::thread::sleep(std::time::Duration::from_millis(10))
                    }
                    Err(_) => return Err("[git.lock] Repository lock unavailable".into()),
                }
            });
            write_guard = None;
        }
        if workspace.generation() != generation {
            return Err("[workspace.generation] Workspace changed while waiting for Git".into());
        }
        let result = work(cwd.to_string_lossy().into_owned());
        drop(write_guard);
        drop(read_guard);
        if workspace.generation() != generation {
            return Err("[workspace.generation] Workspace changed during Git operation".into());
        }
        result.map_err(|error| crate::redaction::redact(&error))
    })
    .await
    .map_err(|_| "[git.worker] Git worker failed".to_string())?
}

fn validate_file_argument(file: &str) -> Result<(), String> {
    if file.is_empty()
        || file.len() > 4096
        || file.contains('\0')
        || file.starts_with(':')
        || Path::new(file).is_absolute()
        || Path::new(file)
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(
            "[git.path] Git file path must be workspace-relative without pathspec syntax".into(),
        );
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct GitFile {
    pub path: String,
    pub name: String,
    pub status: String,
    pub is_staged: bool,
    pub is_conflict: bool,
    pub is_untracked: bool,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    pub message: String,
    pub date: String,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct GitFullStatus {
    pub repo_path: String,
    pub is_repo: bool,
    pub files: Vec<GitFile>,
    pub commits: Vec<GitCommit>,
    pub branch: String,
    pub branches: Vec<GitBranch>,
    pub has_remote: bool,
    pub ahead: u32,
    pub behind: u32,
}

fn command_error(output: &std::process::Output) -> String {
    let stderr = crate::redaction::redact(String::from_utf8_lossy(&output.stderr).trim());
    if stderr.is_empty() {
        "Git command failed without an error message".to_string()
    } else {
        stderr
    }
}

fn git_output(path: &str, args: &[&str]) -> Result<std::process::Output, String> {
    if run_cancelled() {
        return Err("[git.cancelled] Git operation cancelled".into());
    }
    let mut output =
        crate::process_service::spawn_protected("git", args, Some(Path::new(path)), false)?
            .wait_until(std::time::Duration::from_secs(60), run_cancelled)
            .map_err(|error| crate::redaction::redact(&error))?;
    output.stderr = crate::redaction::redact(&String::from_utf8_lossy(&output.stderr)).into_bytes();
    Ok(output)
}

fn git_input(path: &str, args: &[&str], input: &[u8]) -> Result<String, String> {
    if run_cancelled() {
        return Err("[git.cancelled] Git operation cancelled".into());
    }
    let output = crate::process_service::capture_with_input(
        "git",
        args,
        Some(Path::new(path)),
        input,
        std::time::Duration::from_secs(60),
        run_cancelled,
    )?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn git_value(path: &str, args: &[&str]) -> Result<String, String> {
    let output = git_output(path, args)?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn validate_branch_name(path: &str, branch: &str) -> Result<(), String> {
    if branch.trim() != branch || branch.is_empty() {
        return Err("Branch name cannot be empty or contain surrounding whitespace".to_string());
    }
    let output = git_output(path, &["check-ref-format", "--branch", branch])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&output))
    }
}

pub(crate) fn git_check_is_repo_internal(path: String) -> Result<bool, String> {
    let output = git_output(&path, &["rev-parse", "--is-inside-work-tree"])?;

    Ok(output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true")
}

fn git_init_internal(path: String) -> Result<(), String> {
    let output = git_output(&path, &["init"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub(crate) fn git_status_internal(path: String) -> Result<Vec<GitFile>, String> {
    let output = git_output(&path, &["status", "--porcelain=v1", "-z", "-uall"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let mut files = Vec::new();
    let records = output
        .stdout
        .split(|byte| *byte == b'\0')
        .collect::<Vec<_>>();
    let mut index = 0;

    while index < records.len() {
        let record = records[index];
        if record.len() < 4 {
            index += 1;
            continue;
        }

        let index_status = record[0] as char;
        let work_tree_status = record[1] as char;
        let conflict = matches!(
            (index_status, work_tree_status),
            ('D', 'D')
                | ('A', 'U')
                | ('U', 'D')
                | ('U', 'A')
                | ('D', 'U')
                | ('A', 'A')
                | ('U', 'U')
        );
        let untracked = index_status == '?' && work_tree_status == '?';
        let file_path = String::from_utf8_lossy(&record[3..]).to_string();
        let name = Path::new(&file_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        if conflict {
            files.push(GitFile {
                path: file_path.clone(),
                name: name.clone(),
                status: "!".to_string(),
                is_staged: false,
                is_conflict: true,
                is_untracked: false,
            });
        } else if index_status != ' ' && index_status != '?' {
            files.push(GitFile {
                path: file_path.clone(),
                name: name.clone(),
                status: index_status.to_string(),
                is_staged: true,
                is_conflict: false,
                is_untracked: false,
            });
        }

        if !conflict && work_tree_status != ' ' {
            files.push(GitFile {
                path: file_path.clone(),
                name: name.clone(),
                status: if untracked {
                    "?".to_string()
                } else {
                    work_tree_status.to_string()
                },
                is_staged: false,
                is_conflict: false,
                is_untracked: untracked,
            });
        }

        index += if matches!(index_status, 'R' | 'C') || matches!(work_tree_status, 'R' | 'C') {
            2
        } else {
            1
        };
    }

    Ok(files)
}

pub(crate) fn git_add_internal(path: String, file: String) -> Result<(), String> {
    let output = git_output(&path, &["add", "--", &file])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub(crate) fn git_unstage_internal(path: String, file: String) -> Result<(), String> {
    let output = git_output(&path, &["reset", "HEAD", "--", &file])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub(crate) fn git_commit_internal(path: String, message: String) -> Result<(), String> {
    let output = git_output(&path, &["commit", "-m", &message])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub(crate) fn git_current_branch_internal(path: String) -> Result<String, String> {
    let output = git_output(&path, &["rev-parse", "--abbrev-ref", "HEAD"])?;

    if !output.status.success() {
        return Ok("".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_branches_internal(path: String) -> Result<Vec<GitBranch>, String> {
    let output = git_output(
        &path,
        &[
            "for-each-ref",
            "--format=%(refname:short)%00%(HEAD)",
            "refs/heads",
        ],
    )?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let (name, marker) = line.split_once('\0')?;
            Some(GitBranch {
                name: name.to_string(),
                is_current: marker.trim() == "*",
            })
        })
        .collect())
}

pub(crate) fn git_tracking_status_internal(path: String) -> Result<(u32, u32), String> {
    let output = git_output(
        &path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )?;
    if !output.status.success() {
        return Ok((0, 0));
    }
    let counts = String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .filter_map(|value| value.parse::<u32>().ok())
        .collect::<Vec<_>>();
    Ok((
        counts.first().copied().unwrap_or(0),
        counts.get(1).copied().unwrap_or(0),
    ))
}

fn git_switch_branch_internal(path: String, branch: String) -> Result<(), String> {
    validate_branch_name(&path, &branch)?;
    let output = git_output(&path, &["switch", &branch])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&output))
    }
}

fn git_create_branch_internal(path: String, branch: String) -> Result<(), String> {
    validate_branch_name(&path, &branch)?;
    let output = git_output(&path, &["switch", "-c", &branch])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&output))
    }
}

pub(crate) fn git_worktree_diff_internal(
    path: String,
    file: String,
    staged: bool,
) -> Result<String, String> {
    let tracked = git_output(&path, &["ls-files", "--error-unmatch", "--", &file])
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !tracked && !staged {
        let output = git_output(
            &path,
            &[
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-textconv",
                "--color=never",
                "--",
                "/dev/null",
                &file,
            ],
        )?;
        if output.status.success() || output.status.code() == Some(1) {
            return Ok(String::from_utf8_lossy(&output.stdout).to_string());
        }
        return Err(command_error(&output));
    }
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--color=never", "--", &file]);
    let output = git_output(&path, &args)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(command_error(&output))
    }
}

fn selected_hunk_patch(diff: &str, hunk_index: usize) -> Result<String, String> {
    let first_hunk = diff
        .find("@@ -")
        .ok_or_else(|| "This file has no text hunks to apply".to_string())?;
    let header = &diff[..first_hunk];
    if !header.starts_with("diff --git ")
        || !header.contains("\n--- ")
        || !header.contains("\n+++ ")
        || header.lines().any(|line| {
            line.starts_with("new file mode ")
                || line.starts_with("deleted file mode ")
                || line.starts_with("old mode ")
                || line.starts_with("new mode ")
                || line.starts_with("rename ")
                || line.starts_with("copy ")
                || line.starts_with("similarity index ")
                || line.starts_with("Binary files ")
                || line.starts_with("GIT binary patch")
                || line == "--- /dev/null"
                || line == "+++ /dev/null"
        })
        || diff[first_hunk..].contains("\ndiff --git ")
    {
        return Err("Partial staging is unavailable for this file change".to_string());
    }

    let mut starts = vec![first_hunk];
    starts.extend(
        diff[first_hunk..]
            .match_indices("\n@@ -")
            .map(|(position, _)| first_hunk + position + 1),
    );
    let start = *starts
        .get(hunk_index)
        .ok_or_else(|| "Selected hunk is no longer available".to_string())?;
    let end = starts.get(hunk_index + 1).copied().unwrap_or(diff.len());
    Ok(format!("{}{}", header, &diff[start..end]))
}

fn git_apply_hunk_internal(
    path: String,
    file: String,
    staged: bool,
    hunk_index: usize,
    expected_diff: String,
) -> Result<(), String> {
    if expected_diff.len() > 2_000_000 {
        return Err("Diff is too large for partial staging".to_string());
    }
    let current_diff = git_worktree_diff_internal(path.clone(), file.clone(), staged)?;
    if current_diff != expected_diff {
        return Err(
            "File changes have moved; refresh the diff before applying this hunk".to_string(),
        );
    }
    let patch = selected_hunk_patch(&current_diff, hunk_index)?;
    let args = if staged {
        &["apply", "--cached", "--reverse", "--recount", "-"][..]
    } else {
        &["apply", "--cached", "--recount", "-"][..]
    };
    let output = crate::process_service::capture_with_input(
        "git",
        args,
        Some(Path::new(&path)),
        patch.as_bytes(),
        std::time::Duration::from_secs(15),
        run_cancelled,
    )?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&output))
    }
}

fn git_discard_file_internal(path: String, file: String) -> Result<(), String> {
    let tracked = git_output(&path, &["ls-files", "--error-unmatch", "--", &file])
        .map(|output| output.status.success())
        .unwrap_or(false);
    let output = if tracked {
        git_output(&path, &["restore", "--worktree", "--", &file])?
    } else {
        git_output(&path, &["clean", "-f", "--", &file])?
    };
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&output))
    }
}

#[tauri::command]
pub async fn git_push(app: tauri::AppHandle, path: String) -> Result<(), String> {
    run_scoped(app, path, true, move |path| {
        let output = git_output(&path, &["push"])?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_pull(app: tauri::AppHandle, path: String) -> Result<(), String> {
    run_scoped(app, path, true, move |path| {
        let output = git_output(&path, &["pull"])?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_fetch(app: tauri::AppHandle, path: String) -> Result<(), String> {
    run_scoped(app, path, true, move |path| {
        let output = git_output(&path, &["fetch", "--prune"])?;
        if output.status.success() {
            Ok(())
        } else {
            Err(command_error(&output))
        }
    })
    .await
}

fn discard_fingerprint(workspace: &WorkspaceState, path: &str) -> Result<(String, usize), String> {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    let status = git_status_internal(path.to_string())?;
    if status.len() > 10_000 {
        return Err("[resource.limit] Git recovery change count exceeds limit".into());
    }
    for args in [
        &["status", "--porcelain=v1", "-z", "-uall"][..],
        &["diff", "--binary", "--no-ext-diff", "--no-textconv"],
        &[
            "diff",
            "--cached",
            "--binary",
            "--no-ext-diff",
            "--no-textconv",
        ],
    ] {
        let output = git_output(path, args)?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        hash.update(output.stdout);
    }
    for file in &status {
        validate_file_argument(&file.path)?;
        hash.update(file.path.as_bytes());
        let target = Path::new(path).join(&file.path);
        if target.try_exists().map_err(|e| e.to_string())? {
            hash.update(
                workspace
                    .content_digest(&target.to_string_lossy())?
                    .as_bytes(),
            );
        } else {
            hash.update(b"deleted");
        }
    }
    Ok((format!("{:x}", hash.finalize()), status.len()))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitRecovery {
    pub hash: String,
    pub created: String,
}

#[derive(Default)]
struct RecoveryTree {
    files: std::collections::BTreeMap<String, (String, String)>,
    directories: std::collections::BTreeMap<String, RecoveryTree>,
}

fn validate_recovery_path(path: &str) -> Result<(), String> {
    validate_file_argument(path)?;
    if Path::new(path).components().any(|part| {
        let name = part.as_os_str().to_string_lossy();
        name.eq_ignore_ascii_case(".git") || name.eq_ignore_ascii_case(".aurona-recovery")
    }) {
        return Err(
            "[git.recovery_protected] Recovery cannot modify repository or recovery storage".into(),
        );
    }
    Ok(())
}

impl RecoveryTree {
    fn insert(&mut self, path: &str, mode: String, hash: String) -> Result<(), String> {
        validate_file_argument(path)?;
        let mut node = self;
        let mut names = path.split('/').peekable();
        while let Some(name) = names.next() {
            if names.peek().is_none() {
                if node.directories.contains_key(name)
                    || node.files.insert(name.into(), (mode, hash)).is_some()
                {
                    return Err("[git.recovery] Conflicting recovery paths".into());
                }
                return Ok(());
            }
            if node.files.contains_key(name) {
                return Err("[git.recovery] Conflicting recovery paths".into());
            }
            node = node.directories.entry(name.into()).or_default();
        }
        Err("[git.recovery] Empty recovery path".into())
    }

    fn persist(&self, repository: &str) -> Result<String, String> {
        let mut input = Vec::new();
        for (name, (mode, hash)) in &self.files {
            input.extend_from_slice(format!("{mode} blob {hash}\t{name}\0").as_bytes());
        }
        for (name, directory) in &self.directories {
            let hash = directory.persist(repository)?;
            input.extend_from_slice(format!("040000 tree {hash}\t{name}\0").as_bytes());
        }
        git_input(repository, &["mktree", "-z"], &input)
    }
}

fn recovery_commit(
    path: &str,
    tree: &str,
    parents: &[&str],
    message: &str,
) -> Result<String, String> {
    let mut args = vec![
        "-c",
        "user.name=Aurona Recovery",
        "-c",
        "user.email=recovery@aurona.local",
        "-c",
        "commit.gpgsign=false",
        "commit-tree",
        tree,
    ];
    for parent in parents {
        args.extend(["-p", parent]);
    }
    git_input(path, &args, message.as_bytes())
}

fn create_discard_recovery(
    path: &str,
    mut read_file: impl FnMut(&str) -> Result<(Vec<u8>, String), String>,
) -> Result<GitRecovery, String> {
    let records = git_value(
        path,
        &[
            "for-each-ref",
            "--format=%(refname)",
            "refs/aurona/recovery/",
        ],
    )?;
    if records.lines().count() >= 128 {
        return Err("[resource.limit] Git recovery record limit reached; preserve or remove old records first".into());
    }
    let head = git_value(path, &["rev-parse", "HEAD"])?;
    let tracked = git_value(path, &["stash", "create"])?;
    let (tree, index) = if tracked.is_empty() {
        let tree = git_value(path, &["rev-parse", "HEAD^{tree}"])?;
        let index = recovery_commit(path, &tree, &[&head], "Aurona recovery index")?;
        (tree, index)
    } else {
        (
            git_value(path, &["rev-parse", &format!("{tracked}^{{tree}}")])?,
            git_value(path, &["rev-parse", &format!("{tracked}^2")])?,
        )
    };
    let mut bytes = 0usize;
    let status = git_status_internal(path.to_owned())?;
    if status.len() > 10_000 {
        return Err("[resource.limit] Git recovery change count exceeds limit".into());
    }
    // Git porcelain emits one record per index/worktree side. Recovery stores
    // the final worktree bytes once per path, while retaining whether a path
    // is untracked for its separate parent tree.
    let mut changed_paths = std::collections::BTreeMap::<String, bool>::new();
    for file in &status {
        changed_paths
            .entry(file.path.clone())
            .and_modify(|untracked| *untracked |= file.is_untracked)
            .or_insert(file.is_untracked);
    }
    // A fourth parent preserves working-tree bytes independently of Git filters.
    let mut raw = RecoveryTree::default();
    let mut untracked = RecoveryTree::default();
    for (file_path, is_untracked) in &changed_paths {
        validate_recovery_path(file_path)?;
        let target = Path::new(path).join(file_path);
        match std::fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            _ => return Err("[git.recovery] Linked or nested repository recovery is unsupported; working tree preserved".into()),
        }
        let (contents, mode) = read_file(file_path)?;
        if !matches!(mode.as_str(), "100644" | "100755") {
            return Err("[git.recovery] Unsupported raw file mode".into());
        }
        bytes = bytes
            .checked_add(contents.len())
            .ok_or("[resource.limit] Git recovery exceeds limit")?;
        if contents.len() > crate::resource_limits::TEXT_BYTES || bytes > 256 * 1024 * 1024 {
            return Err(
                "[resource.limit] Git recovery exceeds 32 MiB per file or 256 MiB total".into(),
            );
        }
        let hash = git_input(path, &["hash-object", "-w", "--stdin"], &contents)?;
        let saved_size = git_value(path, &["cat-file", "-s", &hash])?;
        if saved_size.parse::<usize>().ok() != Some(contents.len()) {
            return Err("[git.recovery] Untracked recovery object failed verification".into());
        }
        if *is_untracked {
            untracked.insert(file_path, mode.clone(), hash.clone())?;
        }
        raw.insert(file_path, mode, hash)?;
    }
    let untracked_tree = untracked.persist(path)?;
    let untracked_commit = recovery_commit(
        path,
        &untracked_tree,
        &[],
        "Aurona recovery untracked files",
    )?;
    let message = format!("Aurona 0.4.14 recovery {:032x}", rand::random::<u128>());
    let raw_tree = raw.persist(path)?;
    let raw_commit = recovery_commit(path, &raw_tree, &[], "Aurona recovery raw bytes v1")?;
    // Preserve worktree deletions independently of Git's filters. Comparing
    // HEAD with the worktree (without rename detection) yields both sides of
    // renames; only missing paths are recorded as tombstones.
    let deleted_output = git_output(
        path,
        &["diff", "HEAD", "--name-only", "--no-renames", "-z", "--"],
    )?;
    if !deleted_output.status.success() {
        return Err(command_error(&deleted_output));
    }
    let mut deleted = RecoveryTree::default();
    let empty_blob = git_input(path, &["hash-object", "-w", "--stdin"], &[])?;
    let mut deleted_paths = std::collections::BTreeSet::new();
    for entry in deleted_output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
    {
        let file =
            std::str::from_utf8(entry).map_err(|_| "[git.recovery] Non-UTF8 deleted path")?;
        validate_recovery_path(file)?;
        if std::fs::symlink_metadata(Path::new(path).join(file))
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
        {
            deleted_paths.insert(file.to_owned());
        }
    }
    for file in deleted_paths {
        deleted.insert(&file, "100644".into(), empty_blob.clone())?;
    }
    let deleted_tree = deleted.persist(path)?;
    let deleted_commit = recovery_commit(
        path,
        &deleted_tree,
        &[],
        "Aurona recovery worktree deletions v1",
    )?;
    let hash = recovery_commit(
        path,
        &tree,
        &[
            &head,
            &index,
            &untracked_commit,
            &raw_commit,
            &deleted_commit,
        ],
        &message,
    )?;
    git_value(path, &["fsck", "--no-reflogs", "--no-dangling", &hash])?;
    git_value(
        path,
        &["update-ref", &format!("refs/aurona/recovery/{hash}"), &hash],
    )?;
    let persisted = git_value(
        path,
        &["rev-parse", &format!("refs/aurona/recovery/{hash}")],
    )?;
    if persisted != hash {
        return Err("[git.recovery] Recovery ref failed verification".into());
    }
    Ok(GitRecovery {
        hash,
        created: git_value(path, &["show", "-s", "--format=%cI", &persisted])?,
    })
}

fn read_recovery_file(
    workspace: &WorkspaceState,
    path: &str,
    file: &str,
) -> Result<(Vec<u8>, String), String> {
    use std::io::{Read, Seek};
    validate_file_argument(file)?;
    let (directory, name) = workspace.file_access(&Path::new(path).join(file).to_string_lossy())?;
    let mut handle = crate::scoped_file::open(&directory, &name).map_err(|e| e.to_string())?;
    let snapshot = crate::scoped_file::snapshot(&handle)?;
    handle.rewind().map_err(|e| e.to_string())?;
    let mut contents = Vec::new();
    handle
        .by_ref()
        .take(crate::resource_limits::TEXT_BYTES as u64 + 1)
        .read_to_end(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() > crate::resource_limits::TEXT_BYTES {
        return Err("[resource.limit] Git recovery file exceeds 32 MiB".into());
    }
    crate::scoped_file::verify_snapshot(&directory, &name, &snapshot)?;
    use sha2::{Digest, Sha256};
    if format!("{:x}:{}", Sha256::digest(&contents), contents.len()) != snapshot.fingerprint {
        return Err("[file.conflict] Untracked file changed while creating recovery".into());
    }
    #[cfg(unix)]
    let mode = {
        use cap_std::fs::MetadataExt;
        if handle.metadata().map_err(|e| e.to_string())?.mode() & 0o111 != 0 {
            "100755"
        } else {
            "100644"
        }
    };
    #[cfg(not(unix))]
    let mode = "100644";
    Ok((contents, mode.into()))
}

fn list_discard_recoveries(path: &str) -> Result<Vec<GitRecovery>, String> {
    let output = git_value(
        path,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(objectname) %(committerdate:iso-strict)",
            "refs/aurona/recovery/",
        ],
    )?;
    if output.lines().count() > 128 {
        return Err("[resource.limit] Too many Git recovery records".into());
    }
    output
        .lines()
        .map(|line| {
            let (hash, created) = line
                .split_once(' ')
                .ok_or("[git.recovery] Invalid recovery record")?;
            Ok(GitRecovery {
                hash: hash.into(),
                created: created.into(),
            })
        })
        .collect()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GitRestoreJournal {
    schema_version: u32,
    recovery: String,
    head: String,
    index_before: String,
    index_after: String,
    files: std::collections::BTreeMap<String, (Option<String>, Option<String>)>,
}

const RESTORE_JOURNAL: &str = "aurona-restore-journal.json";

fn current_recovery_blob(
    workspace: &WorkspaceState,
    repository: &str,
    file: &str,
) -> Result<Option<String>, String> {
    validate_recovery_path(file)?;
    if !workspace.exists(&Path::new(repository).join(file).to_string_lossy())? {
        return Ok(None);
    }
    let (bytes, _) = read_recovery_file(workspace, repository, file)?;
    git_input(repository, &["hash-object", "--stdin"], &bytes).map(Some)
}

fn restore_discard_recovery(
    workspace: &WorkspaceState,
    path: &str,
    hash: &str,
) -> Result<(), String> {
    restore_discard_recovery_with_hook(workspace, path, hash, |_| Ok(()))
}

fn restore_discard_recovery_with_hook(
    workspace: &WorkspaceState,
    path: &str,
    hash: &str,
    mut before_operation: impl FnMut(usize) -> Result<(), String>,
) -> Result<(), String> {
    if !matches!(hash.len(), 40 | 64) || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("[git.recovery] Invalid recovery hash".into());
    }
    let git_directory = git_value(path, &["rev-parse", "--absolute-git-dir"])?;
    let storage = workspace.directory_handle(&git_directory)?;
    let journal = match crate::scoped_file::open(&storage, Path::new(RESTORE_JOURNAL)) {
        Ok(file) => {
            use std::io::Read;
            let mut bytes = Vec::new();
            file.take(4 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 4 * 1024 * 1024 {
                return Err("[resource.limit] Git restore journal exceeds limit".into());
            }
            Some(
                serde_json::from_slice::<GitRestoreJournal>(&bytes).map_err(|_| {
                    "[git.recovery_journal] Invalid restore journal; preserve it for recovery"
                })?,
            )
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    if journal.is_none() && !git_status_internal(path.to_owned())?.is_empty() {
        return Err(
            "[git.recovery_conflict] Restore requires a clean working tree and index".into(),
        );
    }
    let head = git_value(path, &["rev-parse", "HEAD"])?;
    let record = git_value(
        path,
        &["rev-parse", &format!("refs/aurona/recovery/{hash}")],
    )?;
    if record != hash || head != git_value(path, &["rev-parse", &format!("{hash}^1")])? {
        return Err("[git.recovery_conflict] Recovery record or repository HEAD changed".into());
    }
    let raw_parent = git_output(path, &["rev-parse", "--verify", &format!("{hash}^4")])?;
    if !raw_parent.status.success() {
        return Err("[git.recovery_format] Recovery record has no raw-byte snapshot; working tree preserved".into());
    }
    let mut raw_files = Vec::new();
    let mut bytes = 0usize;
    if raw_parent.status.success() {
        let output = git_output(path, &["ls-tree", "-rz", &format!("{hash}^4")])?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        for entry in output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
        {
            let entry =
                std::str::from_utf8(entry).map_err(|_| "[git.recovery] Non-UTF8 recovery path")?;
            let (header, file) = entry
                .split_once('\t')
                .ok_or("[git.recovery] Invalid raw entry")?;
            validate_recovery_path(file)?;
            let fields = header.split_whitespace().collect::<Vec<_>>();
            if fields.len() != 3 || !matches!(fields[0], "100644" | "100755") || fields[1] != "blob"
            {
                return Err("[git.recovery] Invalid raw entry type".into());
            }
            let size = git_value(path, &["cat-file", "-s", fields[2]])?
                .parse::<usize>()
                .map_err(|_| "[git.recovery] Invalid raw blob size")?;
            bytes = bytes
                .checked_add(size)
                .ok_or("[resource.limit] Recovery size overflow")?;
            if size > crate::resource_limits::TEXT_BYTES
                || bytes > 256 * 1024 * 1024
                || raw_files.len() >= 10_000
            {
                return Err("[resource.limit] Raw recovery exceeds limit".into());
            }
            workspace.exists(&Path::new(path).join(file).to_string_lossy())?;
            raw_files.push((
                file.to_owned(),
                fields[2].to_owned(),
                size,
                fields[0].to_owned(),
            ));
        }
    }
    let deleted_parent = git_output(path, &["rev-parse", "--verify", &format!("{hash}^5")])?;
    let mut deleted_files = Vec::new();
    if deleted_parent.status.success() {
        let output = git_output(path, &["ls-tree", "-rz", &format!("{hash}^5")])?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        for entry in output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
        {
            let entry = std::str::from_utf8(entry)
                .map_err(|_| "[git.recovery] Non-UTF8 deleted recovery path")?;
            let (header, file) = entry
                .split_once('\t')
                .ok_or("[git.recovery] Invalid deleted entry")?;
            let fields = header.split_whitespace().collect::<Vec<_>>();
            if fields.len() != 3 || !matches!(fields[0], "100644" | "100755") || fields[1] != "blob"
            {
                return Err("[git.recovery] Invalid deleted entry type".into());
            }
            validate_recovery_path(file)?;
            if deleted_files.len() >= 10_000 {
                return Err("[resource.limit] Too many recovery deletions".into());
            }
            workspace.exists(&Path::new(path).join(file).to_string_lossy())?;
            deleted_files.push(file.to_owned());
        }
    }
    let index_tree = git_value(path, &["rev-parse", &format!("{hash}^2^{{tree}}")])?;
    let index_current = git_value(path, &["write-tree"])?;
    let mut targets = std::collections::BTreeMap::new();
    for (file, blob, _, _) in &raw_files {
        if targets.insert(file.clone(), Some(blob.clone())).is_some() {
            return Err("[git.recovery] Duplicate restore target".into());
        }
    }
    for file in &deleted_files {
        if targets.insert(file.clone(), None).is_some() {
            return Err("[git.recovery] Conflicting restore targets".into());
        }
    }
    if targets.len() > 10_000 {
        return Err("[resource.limit] Too many restore targets".into());
    }
    let journal = if let Some(journal) = journal {
        if journal.schema_version != 1
            || journal.recovery != hash
            || journal.head != head
            || journal.index_after != index_tree
            || journal.files.len() != targets.len()
            || targets.iter().any(|(file, after)| {
                journal
                    .files
                    .get(file)
                    .is_none_or(|(_, expected)| expected != after)
            })
        {
            return Err("[git.recovery_journal] Journal does not match this recovery; original data preserved".into());
        }
        if index_current != journal.index_before && index_current != journal.index_after {
            return Err("[git.recovery_conflict] Index changed after interrupted restore".into());
        }
        for change in git_status_internal(path.to_owned())? {
            if !targets.contains_key(&change.path) {
                return Err(
                    "[git.recovery_conflict] New changes exist outside the interrupted restore"
                        .into(),
                );
            }
        }
        for (file, (before, after)) in &journal.files {
            let current = current_recovery_blob(workspace, path, file)?;
            if current != *before && current != *after {
                return Err(format!(
                    "[git.recovery_conflict] {file} changed after interrupted restore"
                ));
            }
        }
        journal
    } else {
        let mut files = std::collections::BTreeMap::new();
        for (file, after) in &targets {
            files.insert(
                file.clone(),
                (current_recovery_blob(workspace, path, file)?, after.clone()),
            );
        }
        let journal = GitRestoreJournal {
            schema_version: 1,
            recovery: hash.into(),
            head,
            index_before: index_current,
            index_after: index_tree.clone(),
            files,
        };
        let bytes = serde_json::to_vec(&journal).map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("[resource.limit] Git restore journal exceeds limit".into());
        }
        crate::scoped_file::write(&storage, Path::new(RESTORE_JOURNAL), &bytes)?;
        journal
    };
    // The durable journal accepts only pre-restore or intended bytes on retry.
    // Persist it before changing the index so a crash in any file is resumable.
    before_operation(0)?;
    // The index snapshot is an ordinary tree commit. read-tree restores the
    // exact staged state without applying a filtered stash patch to the
    // worktree; raw files below restore exact on-disk bytes separately.
    git_value(path, &["read-tree", &index_tree])?;
    let mut completed = 1;
    for file in deleted_files {
        before_operation(completed)?;
        if run_cancelled() {
            return Err(format!(
                "[git.cancelled] Raw restore interrupted; recovery {hash} is preserved"
            ));
        }
        let target = Path::new(path).join(&file);
        let (before, after) = &journal.files[&file];
        let current = current_recovery_blob(workspace, path, &file)?;
        if current != *before && current != *after {
            return Err(format!(
                "[git.recovery_conflict] {file} changed during restore"
            ));
        }
        if !workspace.exists(&target.to_string_lossy())? {
            continue;
        }
        let (directory, name) = workspace.write_access(&target.to_string_lossy())?;
        directory.remove_file(&name).map_err(|error| {
            format!("[git.recovery] Could not restore deletion for {file}; recovery {hash} is preserved: {error}")
        })?;
        completed += 1;
    }
    for (file, blob, size, mode) in raw_files {
        before_operation(completed)?;
        if run_cancelled() {
            return Err(format!(
                "[git.cancelled] Raw restore interrupted; recovery {hash} is preserved"
            ));
        }
        let (before, after) = &journal.files[&file];
        let current = current_recovery_blob(workspace, path, &file)?;
        if current != *before && current != *after {
            return Err(format!(
                "[git.recovery_conflict] {file} changed during restore"
            ));
        }
        // Untracked directories may have disappeared during discard. Create
        // each ancestor through its scoped parent handle and reopen nofollow.
        if let Some(parent) = Path::new(&file).parent() {
            let mut target = Path::new(path).to_owned();
            for component in parent.components() {
                target.push(component.as_os_str());
                if !workspace.exists(&target.to_string_lossy())? {
                    let (directory, name) = workspace.write_access(&target.to_string_lossy())?;
                    match directory.create_dir(&name) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                        Err(error) => return Err(error.to_string()),
                    }
                }
                let (directory, name) = workspace.write_access(&target.to_string_lossy())?;
                directory
                    .open_dir_nofollow(&name)
                    .map_err(|error| error.to_string())?;
            }
        }
        let (directory, name) =
            workspace.write_access(&Path::new(path).join(file).to_string_lossy())?;
        let stage = crate::scoped_file::StagedFile::new(&directory)?;
        let output = crate::process_service::capture_to_file(
            "git",
            &["cat-file", "blob", &blob],
            Path::new(path),
            stage.file.try_clone().map_err(|e| e.to_string())?,
            size,
            run_cancelled,
        )?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        #[cfg(unix)]
        {
            use cap_std::fs::PermissionsExt;
            stage
                .file
                .set_permissions(cap_std::fs::Permissions::from_mode(if mode == "100755" {
                    0o755
                } else {
                    0o644
                }))
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(unix))]
        let _ = mode;
        stage.commit(&name)?;
        completed += 1;
    }
    if git_value(path, &["write-tree"])? != journal.index_after {
        return Err(
            "[git.recovery_conflict] Index changed during restore; journal preserved".into(),
        );
    }
    for (file, (_, after)) in &journal.files {
        if current_recovery_blob(workspace, path, file)? != *after {
            return Err(format!(
                "[git.recovery_conflict] {file} changed during final restore verification"
            ));
        }
    }
    storage
        .remove_file(RESTORE_JOURNAL)
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    storage
        .into_std_file()
        .sync_all()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn git_unstage_all_internal(path: String) -> Result<(), String> {
    let output = git_output(&path, &["reset"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub(crate) fn git_get_remote_internal(path: String) -> Result<String, String> {
    let configured_url = git_output(&path, &["config", "--local", "--get", "remote.origin.url"])?;
    if configured_url.status.success() {
        if configured_url.stdout.trim_ascii().is_empty() {
            return Err("origin has an empty URL".to_string());
        }
        let output = git_output(&path, &["remote", "get-url", "origin"])?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else if configured_url.status.code() == Some(1) {
        let configured_origin = git_output(
            &path,
            &["config", "--local", "--get-regexp", "^remote\\.origin\\."],
        )?;
        if configured_origin.status.success() {
            Err("origin is configured without a URL".to_string())
        } else if configured_origin.status.code() == Some(1) {
            Ok(String::new())
        } else {
            Err(command_error(&configured_origin))
        }
    } else {
        Err(command_error(&configured_url))
    }
}

fn git_set_remote_internal(path: String, url: String) -> Result<(), String> {
    let has_remote = git_output(&path, &["remote", "get-url", "origin"])
        .map(|output| output.status.success())
        .unwrap_or(false);

    let output = if has_remote {
        git_output(&path, &["remote", "set-url", "origin", &url])?
    } else {
        git_output(&path, &["remote", "add", "origin", &url])?
    };

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_diff_commit_internal(path: String, hash: String) -> Result<String, String> {
    if !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid commit hash".to_string());
    }
    let output = git_output(&path, &["show", &hash, "--pretty=format:", "--color=never"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub(crate) fn git_log_internal(path: String) -> Result<Vec<GitCommit>, String> {
    let output = git_output(
        &path,
        &[
            "log",
            "--pretty=format:%h\x1f%an\x1f%s\x1f%ad",
            "--date=short",
            "-n",
            "50",
        ],
    )?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).to_string();
        if error.contains("does not have any commits yet")
            || error.contains("does not have any commits")
        {
            return Ok(vec![]);
        }
        return Err(error);
    }

    let out_str = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();

    for line in out_str.lines() {
        let parts: Vec<&str> = line.splitn(4, '\x1f').collect();
        if parts.len() == 4 {
            commits.push(GitCommit {
                hash: parts[0].to_string(),
                author: parts[1].to_string(),
                message: parts[2].to_string(),
                date: parts[3].to_string(),
            });
        }
    }

    Ok(commits)
}

#[tauri::command]
pub async fn git_check_is_repo(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    run_scoped(app, path, false, git_check_is_repo_internal).await
}

#[tauri::command]
pub async fn git_init(app: tauri::AppHandle, path: String) -> Result<(), String> {
    run_scoped_target(app, path, true, true, git_init_internal).await
}

#[tauri::command]
pub async fn git_status(app: tauri::AppHandle, path: String) -> Result<Vec<GitFile>, String> {
    run_scoped(app, path, false, git_status_internal).await
}

#[tauri::command]
pub async fn git_add(app: tauri::AppHandle, path: String, file: String) -> Result<(), String> {
    if file != "." {
        validate_file_argument(&file)?;
    }
    run_scoped(app, path, true, move |path| git_add_internal(path, file)).await
}

#[tauri::command]
pub async fn git_unstage(app: tauri::AppHandle, path: String, file: String) -> Result<(), String> {
    validate_file_argument(&file)?;
    run_scoped(app, path, true, move |path| {
        git_unstage_internal(path, file)
    })
    .await
}

#[tauri::command]
pub async fn git_commit(
    app: tauri::AppHandle,
    path: String,
    message: String,
) -> Result<(), String> {
    if message.len() > 64 * 1024 {
        return Err("[resource.limit] Commit message exceeds limit".into());
    }
    run_scoped(app, path, true, move |path| {
        git_commit_internal(path, message)
    })
    .await
}

#[tauri::command]
pub async fn git_current_branch(app: tauri::AppHandle, path: String) -> Result<String, String> {
    run_scoped(app, path, false, git_current_branch_internal).await
}

#[tauri::command]
pub async fn git_switch_branch(
    app: tauri::AppHandle,
    path: String,
    branch: String,
) -> Result<(), String> {
    run_scoped(app, path, true, move |path| {
        git_switch_branch_internal(path, branch)
    })
    .await
}

#[tauri::command]
pub async fn git_create_branch(
    app: tauri::AppHandle,
    path: String,
    branch: String,
) -> Result<(), String> {
    run_scoped(app, path, true, move |path| {
        git_create_branch_internal(path, branch)
    })
    .await
}

#[tauri::command]
pub async fn git_worktree_diff(
    app: tauri::AppHandle,
    path: String,
    file: String,
    staged: bool,
) -> Result<String, String> {
    validate_file_argument(&file)?;
    run_scoped(app, path, false, move |path| {
        git_worktree_diff_internal(path, file, staged)
    })
    .await
}

#[tauri::command]
pub async fn git_apply_hunk(
    app: tauri::AppHandle,
    path: String,
    file: String,
    staged: bool,
    hunk_index: usize,
    expected_diff: String,
) -> Result<(), String> {
    validate_file_argument(&file)?;
    if expected_diff.len() > 4 * 1024 * 1024 {
        return Err("[resource.limit] Patch exceeds limit".into());
    }
    run_scoped(app, path, true, move |path| {
        git_apply_hunk_internal(path, file, staged, hunk_index, expected_diff)
    })
    .await
}

#[tauri::command]
pub async fn git_discard_file(
    app: tauri::AppHandle,
    path: String,
    file: String,
) -> Result<(), String> {
    validate_file_argument(&file)?;
    run_scoped(app, path, true, move |path| {
        git_discard_file_internal(path, file)
    })
    .await
}

#[tauri::command]
pub async fn git_discard_all(
    app: tauri::AppHandle,
    path: String,
) -> Result<Option<GitRecovery>, String> {
    let generation = app.state::<WorkspaceState>().generation();
    let preview_app = app.clone();
    let preview = run_scoped(app.clone(), path.clone(), false, move |path| {
        discard_fingerprint(&preview_app.state::<WorkspaceState>(), &path)
    })
    .await?;
    if preview.1 == 0 {
        return Ok(None);
    }
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let (title, body) = crate::authorization_dialogs::text(
        &app,
        "git",
        &[
            ("path", &path),
            ("entries", &preview.1.to_string()),
            ("fingerprint", &preview.0),
        ],
    );
    app.dialog()
        .message(body)
        .title(title)
        .buttons(MessageDialogButtons::YesNo)
        .show(move |approved| {
            let _ = sender.send(approved);
        });
    if !tokio::time::timeout(std::time::Duration::from_secs(60), receiver)
        .await
        .map_err(|_| "[confirmation.expired] Git confirmation expired")?
        .unwrap_or(false)
    {
        return Err("[operation.cancelled] Git discard cancelled".into());
    }
    let recovery_app = app.clone();
    run_scoped(app, path, true, move |path| {
        let workspace = recovery_app.state::<WorkspaceState>();
        if generation != workspace.generation()
            || discard_fingerprint(&workspace, &path)? != preview
        {
            return Err("[confirmation.changed] Git state changed after preview".into());
        }
        let record = create_discard_recovery(&path, |file| read_recovery_file(&workspace, &path, file))?;
        if generation != workspace.generation() || discard_fingerprint(&workspace, &path)? != preview {
            return Err("[confirmation.changed] Git state changed while creating recovery; working tree preserved".into());
        }
        let untracked = git_status_internal(path.clone())?.into_iter().filter(|file| file.is_untracked).collect::<Vec<_>>();
        git_value(&path, &["-c", "core.autocrlf=false", "reset", "--hard", "HEAD"])?;
        for file in untracked {
            if run_cancelled() {
                return Err(format!("[git.cancelled] Discard interrupted; recovery {} is preserved", record.hash));
            }
            let (directory, name) = workspace.write_access(&Path::new(&path).join(&file.path).to_string_lossy())?;
            directory.remove_file(name).map_err(|e| format!("[git.recovery] Discard interrupted; recovery {} is preserved: {e}", record.hash))?;
        }
        Ok(Some(record))
    })
    .await
}

#[tauri::command]
pub async fn git_restore_discard(
    app: tauri::AppHandle,
    path: String,
    stash_hash: String,
) -> Result<(), String> {
    let restore_app = app.clone();
    run_scoped(app, path, true, move |path| {
        restore_discard_recovery(&restore_app.state::<WorkspaceState>(), &path, &stash_hash)
    })
    .await
}

#[tauri::command]
pub async fn git_list_discard_recoveries(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<GitRecovery>, String> {
    run_scoped(app, path, false, move |path| list_discard_recoveries(&path)).await
}

#[tauri::command]
pub async fn git_unstage_all(app: tauri::AppHandle, path: String) -> Result<(), String> {
    run_scoped(app, path, true, git_unstage_all_internal).await
}

#[tauri::command]
pub async fn git_get_remote(app: tauri::AppHandle, path: String) -> Result<String, String> {
    run_scoped(app, path, false, git_get_remote_internal)
        .await
        .map(|url| crate::redaction::redact(&url))
}

#[tauri::command]
pub async fn git_set_remote(
    app: tauri::AppHandle,
    path: String,
    url: String,
) -> Result<(), String> {
    if url.len() > 8192 || url.contains('\0') {
        return Err("[git.remote] Invalid remote URL".into());
    }
    run_scoped(app, path, true, move |path| {
        git_set_remote_internal(path, url)
    })
    .await
}

#[tauri::command]
pub async fn git_diff_commit(
    app: tauri::AppHandle,
    path: String,
    hash: String,
) -> Result<String, String> {
    run_scoped(app, path, false, move |path| {
        git_diff_commit_internal(path, hash)
    })
    .await
}

#[tauri::command]
pub async fn git_log(app: tauri::AppHandle, path: String) -> Result<Vec<GitCommit>, String> {
    run_scoped(app, path, false, git_log_internal).await
}

#[tauri::command]
pub async fn git_get_full_status(
    app: tauri::AppHandle,
    path: String,
) -> Result<GitFullStatus, String> {
    let generation = app.state::<WorkspaceState>().generation();
    let key = (path.clone(), generation);
    let state = app.state::<GitState>();
    let cell = {
        let mut statuses = state.statuses.lock().await;
        if statuses.len() >= 64 && !statuses.contains_key(&key) {
            return Err("[resource.limit] Too many Git status requests".into());
        }
        statuses.entry(key.clone()).or_default().clone()
    };
    let result = cell
        .get_or_init(|| collect_full_status(app.clone(), path))
        .await
        .clone();
    state.statuses.lock().await.remove(&key);
    if app.state::<WorkspaceState>().generation() != generation {
        return Err("[workspace.generation] Workspace changed after Git status".into());
    }
    result
}

#[tauri::command]
pub fn git_cancel(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let cwd = app.state::<WorkspaceState>().require_directory(&path)?;
    let state = app.state::<GitState>();
    let active = state
        .active
        .lock()
        .map_err(|_| "[git.lock] Cancellation registry unavailable")?;
    for flag in active
        .get(&cwd)
        .into_iter()
        .flatten()
        .filter_map(Weak::upgrade)
    {
        flag.store(true, std::sync::atomic::Ordering::Release);
    }
    Ok(())
}

async fn collect_full_status(app: tauri::AppHandle, path: String) -> Result<GitFullStatus, String> {
    run_scoped(app, path, false, move |path| {
        let is_repo = git_check_is_repo_internal(path.clone())?;
        if !is_repo {
            return Ok(GitFullStatus {
                repo_path: path.clone(),
                is_repo: false,
                files: vec![],
                commits: vec![],
                branch: "".to_string(),
                branches: vec![],
                has_remote: false,
                ahead: 0,
                behind: 0,
            });
        }

        let files = git_status_internal(path.clone())?;
        let branch = git_current_branch_internal(path.clone())?;
        let commits = git_log_internal(path.clone())?;
        let branches = git_branches_internal(path.clone())?;
        let has_remote = !git_get_remote_internal(path.clone())?.is_empty();
        let (ahead, behind) = git_tracking_status_internal(path.clone())?;

        Ok::<GitFullStatus, String>(GitFullStatus {
            repo_path: path,
            is_repo: true,
            files,
            commits,
            branch,
            branches,
            has_remote,
            ahead,
            behind,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestRepository(PathBuf);

    impl Drop for TestRepository {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn run_git(path: &Path, args: &[&str]) {
        let output = git_output(path.to_string_lossy().as_ref(), args).expect("git should start");
        assert!(output.status.success(), "{}", command_error(&output));
    }

    fn create_test_repository() -> TestRepository {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("aurona-git-test-{suffix}"));
        fs::create_dir_all(&path).expect("temporary repository should be created");
        run_git(&path, &["init"]);
        run_git(&path, &["config", "user.email", "tests@aurona.local"]);
        run_git(&path, &["config", "user.name", "Aurona Tests"]);
        fs::write(path.join("main.txt"), "first\n").expect("fixture should be written");
        run_git(&path, &["add", "--", "main.txt"]);
        run_git(&path, &["commit", "-m", "initial"]);
        TestRepository(path)
    }

    #[test]
    fn creates_switches_and_lists_branches() {
        let repository = create_test_repository();
        let path = repository.0.to_string_lossy().to_string();
        git_create_branch_internal(path.clone(), "feature/editor".to_string())
            .expect("branch should be created");
        let branches = git_branches_internal(path.clone()).expect("branches should be listed");
        assert!(branches
            .iter()
            .any(|branch| branch.name == "feature/editor" && branch.is_current));
        let original = branches
            .iter()
            .find(|branch| branch.name != "feature/editor")
            .expect("original branch should exist")
            .name
            .clone();
        git_switch_branch_internal(path, original).expect("original branch should be restored");
    }

    #[test]
    fn reads_and_discards_a_worktree_diff() {
        let repository = create_test_repository();
        let path = repository.0.to_string_lossy().to_string();
        fs::write(repository.0.join("main.txt"), "first\nsecond\n")
            .expect("fixture should be updated");
        let diff = git_worktree_diff_internal(path.clone(), "main.txt".to_string(), false)
            .expect("diff should load");
        assert!(diff.contains("+second"));
        git_discard_file_internal(path, "main.txt".to_string())
            .expect("change should be discarded");
        assert_eq!(
            fs::read_to_string(repository.0.join("main.txt"))
                .expect("fixture should remain")
                .replace("\r\n", "\n"),
            "first\n"
        );
    }

    #[test]
    fn reads_and_discards_an_untracked_file() {
        let repository = create_test_repository();
        let path = repository.0.to_string_lossy().to_string();
        fs::write(repository.0.join("new.txt"), "untracked\n")
            .expect("untracked fixture should be written");
        let diff = git_worktree_diff_internal(path.clone(), "new.txt".to_string(), false)
            .expect("untracked diff should load");
        assert!(diff.contains("+untracked"));
        git_discard_file_internal(path, "new.txt".to_string())
            .expect("untracked file should be discarded");
        assert!(!repository.0.join("new.txt").exists());
    }

    #[test]
    fn discard_backup_is_nondestructive_and_restores_index_worktree_and_untracked() {
        let repository = create_test_repository();
        let workspace = WorkspaceState::test_root(&repository.0);
        let path = repository.0.to_string_lossy().to_string();
        fs::write(repository.0.join("main.txt"), "staged\n").unwrap();
        run_git(&repository.0, &["add", "main.txt"]);
        fs::write(repository.0.join("main.txt"), "unstaged\n").unwrap();
        fs::create_dir(repository.0.join("nested")).unwrap();
        fs::write(repository.0.join("nested/new.txt"), "untracked\n").unwrap();
        fs::write(repository.0.join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(repository.0.join("ignored.txt"), "keep\n").unwrap();
        let before = git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap();
        let record = create_discard_recovery(&path, |file| {
            Ok((fs::read(repository.0.join(file)).unwrap(), "100644".into()))
        })
        .unwrap();
        assert_eq!(
            git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
            before
        );
        assert_eq!(
            fs::read_to_string(repository.0.join("main.txt")).unwrap(),
            "unstaged\n"
        );
        assert!(restore_discard_recovery(&workspace, &path, &record.hash).is_err());
        run_git(
            &repository.0,
            &["-c", "core.autocrlf=false", "reset", "--hard", "HEAD"],
        );
        fs::remove_file(repository.0.join("nested/new.txt")).unwrap();
        fs::remove_file(repository.0.join(".gitignore")).unwrap();
        // Keep the ignore rule outside the worktree while checking the restore.
        fs::write(repository.0.join(".git/info/exclude"), "ignored.txt\n").unwrap();
        restore_discard_recovery(&workspace, &path, &record.hash).unwrap();
        assert_eq!(
            git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
            before
        );
        assert_eq!(git_value(&path, &["show", ":main.txt"]).unwrap(), "staged");
        assert_eq!(
            fs::read_to_string(repository.0.join("main.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "unstaged\n"
        );
        assert_eq!(
            fs::read_to_string(repository.0.join("nested/new.txt")).unwrap(),
            "untracked\n"
        );
        assert_eq!(
            fs::read_to_string(repository.0.join("ignored.txt")).unwrap(),
            "keep\n"
        );
        assert!(list_discard_recoveries(&path)
            .unwrap()
            .iter()
            .any(|item| item.hash == record.hash));
    }

    #[test]
    fn initialization_uses_selected_directory_without_authorizing_its_parent_repository() {
        let repository = create_test_repository();
        let target = repository.0.join("nested-workspace");
        fs::create_dir(&target).unwrap();
        let target = target.canonicalize().unwrap();
        let workspace = WorkspaceState::test_root(&target);
        assert!(authorized_repository_root(&workspace, &target, false).is_err());
        assert_eq!(
            authorized_repository_root(&workspace, &target, true).unwrap(),
            target
        );
        git_init_internal(target.to_string_lossy().into_owned()).unwrap();
        assert_eq!(
            authorized_repository_root(&workspace, &target, false).unwrap(),
            target
        );
        assert!(workspace
            .require_directory(&repository.0.to_string_lossy())
            .is_err());
    }

    #[test]
    fn incomplete_discard_backup_never_changes_the_worktree() {
        let repository = create_test_repository();
        let path = repository.0.to_string_lossy().to_string();
        fs::write(repository.0.join("main.txt"), "modified\n").unwrap();
        fs::write(repository.0.join("new.txt"), "untracked\n").unwrap();
        let before = git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap();
        assert!(create_discard_recovery(&path, |_| Err("disk full".into())).is_err());
        assert_eq!(
            git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
            before
        );
        assert!(list_discard_recoveries(&path).unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(repository.0.join("main.txt")).unwrap(),
            "modified\n"
        );
    }

    #[test]
    fn filtered_and_normalized_tracked_files_restore_exact_raw_bytes() {
        let repository = create_test_repository();
        let workspace = WorkspaceState::test_root(&repository.0);
        let path = repository.0.to_string_lossy().to_string();
        fs::write(repository.0.join(".gitattributes"), "main.txt eol=crlf\n").unwrap();
        fs::write(repository.0.join("main.txt"), "modified\r\n").unwrap();
        let before = git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap();
        let record = create_discard_recovery(&path, |file| {
            Ok((fs::read(repository.0.join(file)).unwrap(), "100644".into()))
        })
        .unwrap();
        assert_eq!(
            git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
            before
        );
        assert_eq!(
            fs::read(repository.0.join("main.txt")).unwrap(),
            b"modified\r\n"
        );
        run_git(&repository.0, &["reset", "--hard", "HEAD"]);
        fs::remove_file(repository.0.join(".gitattributes")).unwrap();
        restore_discard_recovery(&workspace, &path, &record.hash).unwrap();
        assert_eq!(
            fs::read(repository.0.join("main.txt")).unwrap(),
            b"modified\r\n"
        );
        assert_eq!(
            git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
            before
        );
        fs::remove_file(repository.0.join(".gitattributes")).unwrap();
        run_git(&repository.0, &["config", "core.autocrlf", "true"]);
        let record = create_discard_recovery(&path, |file| {
            Ok((fs::read(repository.0.join(file)).unwrap(), "100644".into()))
        })
        .unwrap();
        run_git(&repository.0, &["reset", "--hard", "HEAD"]);
        restore_discard_recovery(&workspace, &path, &record.hash).unwrap();
        assert_eq!(
            fs::read(repository.0.join("main.txt")).unwrap(),
            b"modified\r\n"
        );
    }

    #[test]
    fn raw_recovery_streams_large_binary_without_process_output_truncation() {
        let repository = create_test_repository();
        let workspace = WorkspaceState::test_root(&repository.0);
        let path = repository.0.to_string_lossy().to_string();
        let bytes = vec![0x81; 5 * 1024 * 1024];
        fs::write(repository.0.join("large.bin"), &bytes).unwrap();
        let record =
            create_discard_recovery(&path, |file| read_recovery_file(&workspace, &path, file))
                .unwrap();
        fs::remove_file(repository.0.join("large.bin")).unwrap();
        restore_discard_recovery(&workspace, &path, &record.hash).unwrap();
        assert_eq!(fs::read(repository.0.join("large.bin")).unwrap(), bytes);
    }

    #[test]
    fn raw_recovery_restores_staged_renames_worktree_deletions_and_new_directories() {
        let repository = create_test_repository();
        let workspace = WorkspaceState::test_root(&repository.0);
        let path = repository.0.to_string_lossy().to_string();
        fs::write(repository.0.join("deleted.txt"), "delete me\n").unwrap();
        run_git(&repository.0, &["add", "deleted.txt"]);
        run_git(&repository.0, &["commit", "-m", "deletion fixture"]);
        run_git(&repository.0, &["mv", "main.txt", "renamed.txt"]);
        fs::remove_file(repository.0.join("deleted.txt")).unwrap();
        fs::create_dir_all(repository.0.join("new/nested")).unwrap();
        fs::write(repository.0.join("new/nested/bytes.bin"), b"new\0bytes").unwrap();
        let before = git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap();
        let record =
            create_discard_recovery(&path, |file| read_recovery_file(&workspace, &path, file))
                .unwrap();
        run_git(&repository.0, &["reset", "--hard", "HEAD"]);
        fs::remove_dir_all(repository.0.join("new")).unwrap();
        restore_discard_recovery(&workspace, &path, &record.hash).unwrap();
        assert!(!repository.0.join("main.txt").exists());
        assert!(!repository.0.join("deleted.txt").exists());
        assert_eq!(
            fs::read(repository.0.join("new/nested/bytes.bin")).unwrap(),
            b"new\0bytes"
        );
        assert_eq!(
            git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
            before
        );
    }

    #[test]
    fn interrupted_restore_resumes_after_reopening_workspace_at_every_operation() {
        for failure in 0..4 {
            let repository = create_test_repository();
            let path = repository.0.to_string_lossy().to_string();
            let workspace = WorkspaceState::test_root(&repository.0);
            fs::write(repository.0.join("deleted.txt"), "delete me\n").unwrap();
            run_git(&repository.0, &["add", "deleted.txt"]);
            run_git(&repository.0, &["commit", "-m", "restore fixture"]);
            fs::remove_file(repository.0.join("deleted.txt")).unwrap();
            fs::write(repository.0.join("main.txt"), "staged\n").unwrap();
            run_git(&repository.0, &["add", "main.txt"]);
            fs::write(repository.0.join("main.txt"), "raw after staged\r\n").unwrap();
            fs::write(repository.0.join("new.bin"), b"untracked\0bytes").unwrap();
            let before = git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap();
            let index_before = git_value(&path, &["write-tree"]).unwrap();
            let record =
                create_discard_recovery(&path, |file| read_recovery_file(&workspace, &path, file))
                    .unwrap();
            run_git(&repository.0, &["reset", "--hard", "HEAD"]);
            fs::remove_file(repository.0.join("new.bin")).unwrap();
            let error =
                restore_discard_recovery_with_hook(&workspace, &path, &record.hash, |operation| {
                    if operation == failure {
                        Err("injected interruption".into())
                    } else {
                        Ok(())
                    }
                })
                .unwrap_err();
            assert!(error.contains("injected interruption"), "{error}");
            assert!(repository.0.join(".git").join(RESTORE_JOURNAL).exists());
            drop(workspace);
            let reopened = WorkspaceState::test_root(&repository.0);
            restore_discard_recovery(&reopened, &path, &record.hash).unwrap();
            assert!(!repository.0.join(".git").join(RESTORE_JOURNAL).exists());
            assert!(!repository.0.join("deleted.txt").exists());
            assert_eq!(
                fs::read(repository.0.join("main.txt")).unwrap(),
                b"raw after staged\r\n"
            );
            assert_eq!(
                fs::read(repository.0.join("new.bin")).unwrap(),
                b"untracked\0bytes"
            );
            assert_eq!(git_value(&path, &["write-tree"]).unwrap(), index_before);
            assert_eq!(
                git_value(&path, &["status", "--porcelain=v1", "-uall"]).unwrap(),
                before
            );
        }
    }

    #[test]
    fn interrupted_restore_preserves_later_user_edits_and_corrupt_journals() {
        let repository = create_test_repository();
        let path = repository.0.to_string_lossy().to_string();
        let workspace = WorkspaceState::test_root(&repository.0);
        fs::write(repository.0.join("main.txt"), "recovered\n").unwrap();
        fs::write(repository.0.join("new.bin"), b"untracked\0bytes").unwrap();
        let record =
            create_discard_recovery(&path, |file| read_recovery_file(&workspace, &path, file))
                .unwrap();
        run_git(&repository.0, &["reset", "--hard", "HEAD"]);
        fs::remove_file(repository.0.join("new.bin")).unwrap();
        restore_discard_recovery_with_hook(&workspace, &path, &record.hash, |operation| {
            if operation == 2 {
                Err("injected interruption".into())
            } else {
                Ok(())
            }
        })
        .unwrap_err();
        fs::write(
            repository.0.join("main.txt"),
            "user changed after interruption\n",
        )
        .unwrap();
        let before_index = git_value(&path, &["write-tree"]).unwrap();
        let error = restore_discard_recovery(&workspace, &path, &record.hash).unwrap_err();
        assert!(error.contains("git.recovery_conflict"), "{error}");
        assert_eq!(
            fs::read(repository.0.join("main.txt")).unwrap(),
            b"user changed after interruption\n"
        );
        assert!(!repository.0.join("new.bin").exists());
        assert_eq!(git_value(&path, &["write-tree"]).unwrap(), before_index);
        let log = repository.0.join(".git").join(RESTORE_JOURNAL);
        fs::write(&log, b"{corrupt").unwrap();
        let error = restore_discard_recovery(&workspace, &path, &record.hash).unwrap_err();
        assert!(error.contains("git.recovery_journal"), "{error}");
        assert_eq!(fs::read(log).unwrap(), b"{corrupt");
        assert_eq!(
            fs::read(repository.0.join("main.txt")).unwrap(),
            b"user changed after interruption\n"
        );
    }

    #[test]
    fn recovery_rejects_protected_paths_before_restoring_the_index() {
        let repository = create_test_repository();
        let workspace = WorkspaceState::test_root(&repository.0);
        let path = repository.0.to_string_lossy().to_string();
        let head = git_value(&path, &["rev-parse", "HEAD"]).unwrap();
        let head_tree = git_value(&path, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let index = recovery_commit(&path, &head_tree, &[&head], "index").unwrap();
        let empty = RecoveryTree::default().persist(&path).unwrap();
        let untracked = recovery_commit(&path, &empty, &[], "untracked").unwrap();
        let deleted = recovery_commit(&path, &empty, &[], "deleted").unwrap();
        for protected in [".git/config", ".aurona-recovery/log"] {
            let blob = git_input(&path, &["hash-object", "-w", "--stdin"], b"malicious").unwrap();
            let mut raw = RecoveryTree::default();
            raw.insert(protected, "100644".into(), blob).unwrap();
            let raw_tree = raw.persist(&path).unwrap();
            let raw = recovery_commit(&path, &raw_tree, &[], "raw").unwrap();
            let record = recovery_commit(
                &path,
                &head_tree,
                &[&head, &index, &untracked, &raw, &deleted],
                "record",
            )
            .unwrap();
            git_value(
                &path,
                &[
                    "update-ref",
                    &format!("refs/aurona/recovery/{record}"),
                    &record,
                ],
            )
            .unwrap();
            let before = fs::read(repository.0.join(".git/index")).unwrap();
            let error = restore_discard_recovery(&workspace, &path, &record).unwrap_err();
            assert!(error.contains("git.recovery_protected"), "{error}");
            assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), before);
        }
    }

    #[test]
    fn recovery_reads_use_the_scoped_snapshot_format_and_reject_unselected_files() {
        let repository = create_test_repository();
        let workspace = WorkspaceState::new();
        let file = repository.0.join("new.txt");
        fs::write(&file, b"untracked\0bytes\n").unwrap();
        assert!(
            read_recovery_file(&workspace, &repository.0.to_string_lossy(), "new.txt").is_err()
        );
        workspace.authorize_path(&file.to_string_lossy()).unwrap();
        let (contents, mode) =
            read_recovery_file(&workspace, &repository.0.to_string_lossy(), "new.txt").unwrap();
        assert_eq!(contents, b"untracked\0bytes\n");
        assert_eq!(mode, "100644");
        assert!(
            read_recovery_file(&workspace, &repository.0.to_string_lossy(), "../new.txt").is_err()
        );
    }

    #[test]
    fn reports_the_destination_path_for_a_staged_rename() {
        let repository = create_test_repository();
        let path = repository.0.to_string_lossy().to_string();
        run_git(&repository.0, &["mv", "main.txt", "renamed.txt"]);

        let files = git_status_internal(path).expect("status should load");
        assert!(files
            .iter()
            .any(|file| { file.path == "renamed.txt" && file.status == "R" && file.is_staged }));
        assert!(!files.iter().any(|file| file.path == "main.txt"));
    }

    #[test]
    fn distinguishes_missing_origin_from_broken_origin() {
        let repository = create_test_repository();
        let path = repository.0.to_string_lossy().to_string();
        assert_eq!(git_get_remote_internal(path.clone()).unwrap(), "");

        run_git(
            &repository.0,
            &["remote", "add", "origin", "https://example.com/repo.git"],
        );
        assert_eq!(
            git_get_remote_internal(path.clone()).unwrap(),
            "https://example.com/repo.git"
        );

        run_git(&repository.0, &["config", "--unset", "remote.origin.url"]);
        assert!(git_get_remote_internal(path).is_err());
    }

    #[test]
    fn stages_and_unstages_one_hunk_without_touching_other_changes() {
        let repository = create_test_repository();
        let path = repository.0.to_string_lossy().to_string();
        let original = (1..=25)
            .map(|number| format!("line {number}\n"))
            .collect::<String>();
        fs::write(repository.0.join("main.txt"), &original).unwrap();
        run_git(&repository.0, &["add", "--", "main.txt"]);
        run_git(&repository.0, &["commit", "-m", "expand fixture"]);

        let changed = original
            .replace("line 3\n", "line 3 changed\n")
            .replace("line 20\n", "line 20 changed\n");
        fs::write(repository.0.join("main.txt"), changed).unwrap();

        let unstaged = git_worktree_diff_internal(path.clone(), "main.txt".into(), false).unwrap();
        assert_eq!(unstaged.matches("\n@@ -").count(), 2);
        git_apply_hunk_internal(path.clone(), "main.txt".into(), false, 0, unstaged.clone())
            .expect("first hunk should stage");

        let staged = git_worktree_diff_internal(path.clone(), "main.txt".into(), true).unwrap();
        assert!(staged.contains("+line 3 changed"));
        assert!(!staged.contains("+line 20 changed"));
        let remaining = git_worktree_diff_internal(path.clone(), "main.txt".into(), false).unwrap();
        assert!(!remaining.contains("+line 3 changed"));
        assert!(remaining.contains("+line 20 changed"));
        assert!(
            git_apply_hunk_internal(path.clone(), "main.txt".into(), false, 0, unstaged).is_err()
        );

        git_apply_hunk_internal(path.clone(), "main.txt".into(), true, 0, staged)
            .expect("staged hunk should unstage");
        assert!(
            git_worktree_diff_internal(path.clone(), "main.txt".into(), true)
                .unwrap()
                .is_empty()
        );
        let restored = git_worktree_diff_internal(path, "main.txt".into(), false).unwrap();
        assert!(restored.contains("+line 3 changed"));
        assert!(restored.contains("+line 20 changed"));
    }

    #[test]
    fn does_not_offer_partial_staging_for_new_files() {
        let repository = create_test_repository();
        let path = repository.0.to_string_lossy().to_string();
        fs::write(repository.0.join("new.txt"), "new file\n").unwrap();
        run_git(&repository.0, &["add", "--", "new.txt"]);
        let diff = git_worktree_diff_internal(path, "new.txt".into(), true).unwrap();
        assert!(selected_hunk_patch(&diff, 0).is_err());
    }
}
