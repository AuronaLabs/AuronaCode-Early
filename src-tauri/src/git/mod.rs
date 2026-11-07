//! Repository execution, cancellation and status ownership.
pub mod ipc;
mod recovery;
use recovery::*;

use crate::workspace::WorkspaceState;
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
mod tests;
