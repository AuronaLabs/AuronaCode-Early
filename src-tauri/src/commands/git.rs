use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

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

#[derive(Serialize, Deserialize, TS)]
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
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        "Git command failed without an error message".to_string()
    } else {
        stderr
    }
}

fn git_output(path: &str, args: &[&str]) -> Result<std::process::Output, String> {
    crate::process_service::capture("git", args, Some(Path::new(path)))
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

fn git_check_is_repo_internal(path: String) -> Result<bool, String> {
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

fn git_status_internal(path: String) -> Result<Vec<GitFile>, String> {
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

fn git_add_internal(path: String, file: String) -> Result<(), String> {
    let output = git_output(&path, &["add", "--", &file])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_unstage_internal(path: String, file: String) -> Result<(), String> {
    let output = git_output(&path, &["reset", "HEAD", "--", &file])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_commit_internal(path: String, message: String) -> Result<(), String> {
    let output = git_output(&path, &["commit", "-m", &message])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_current_branch_internal(path: String) -> Result<String, String> {
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

fn git_tracking_status_internal(path: String) -> Result<(u32, u32), String> {
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

fn git_worktree_diff_internal(path: String, file: String, staged: bool) -> Result<String, String> {
    let tracked = git_output(&path, &["ls-files", "--error-unmatch", "--", &file])
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !tracked && !staged {
        let output = git_output(
            &path,
            &[
                "diff",
                "--no-index",
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
    let mut args = vec!["diff"];
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
pub async fn git_push(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let output = git_output(&path, &["push"])?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_pull(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let output = git_output(&path, &["pull"])?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_fetch(path: String) -> Result<(), String> {
    run_blocking(move || {
        let output = git_output(&path, &["fetch", "--prune"])?;
        if output.status.success() {
            Ok(())
        } else {
            Err(command_error(&output))
        }
    })
    .await
}

fn git_discard_all_internal(path: String) -> Result<(), String> {
    let output = git_output(&path, &["reset", "--hard", "HEAD"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let output = git_output(&path, &["clean", "-fd"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(())
}

fn git_unstage_all_internal(path: String) -> Result<(), String> {
    let output = git_output(&path, &["reset"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_get_remote_internal(path: String) -> Result<String, String> {
    let output = git_output(&path, &["remote", "get-url", "origin"])?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Ok("".to_string())
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

fn git_log_internal(path: String) -> Result<Vec<GitCommit>, String> {
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

async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| format!("Git worker failed: {error}"))?
}

#[tauri::command]
pub async fn git_check_is_repo(path: String) -> Result<bool, String> {
    run_blocking(move || git_check_is_repo_internal(path)).await
}

#[tauri::command]
pub async fn git_init(path: String) -> Result<(), String> {
    run_blocking(move || git_init_internal(path)).await
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<Vec<GitFile>, String> {
    run_blocking(move || git_status_internal(path)).await
}

#[tauri::command]
pub async fn git_add(path: String, file: String) -> Result<(), String> {
    run_blocking(move || git_add_internal(path, file)).await
}

#[tauri::command]
pub async fn git_unstage(path: String, file: String) -> Result<(), String> {
    run_blocking(move || git_unstage_internal(path, file)).await
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<(), String> {
    run_blocking(move || git_commit_internal(path, message)).await
}

#[tauri::command]
pub async fn git_current_branch(path: String) -> Result<String, String> {
    run_blocking(move || git_current_branch_internal(path)).await
}

#[tauri::command]
pub async fn git_switch_branch(path: String, branch: String) -> Result<(), String> {
    run_blocking(move || git_switch_branch_internal(path, branch)).await
}

#[tauri::command]
pub async fn git_create_branch(path: String, branch: String) -> Result<(), String> {
    run_blocking(move || git_create_branch_internal(path, branch)).await
}

#[tauri::command]
pub async fn git_worktree_diff(path: String, file: String, staged: bool) -> Result<String, String> {
    run_blocking(move || git_worktree_diff_internal(path, file, staged)).await
}

#[tauri::command]
pub async fn git_discard_file(path: String, file: String) -> Result<(), String> {
    run_blocking(move || git_discard_file_internal(path, file)).await
}

#[tauri::command]
pub async fn git_discard_all(path: String) -> Result<(), String> {
    run_blocking(move || git_discard_all_internal(path)).await
}

#[tauri::command]
pub async fn git_unstage_all(path: String) -> Result<(), String> {
    run_blocking(move || git_unstage_all_internal(path)).await
}

#[tauri::command]
pub async fn git_get_remote(path: String) -> Result<String, String> {
    run_blocking(move || git_get_remote_internal(path)).await
}

#[tauri::command]
pub async fn git_set_remote(path: String, url: String) -> Result<(), String> {
    run_blocking(move || git_set_remote_internal(path, url)).await
}

#[tauri::command]
pub async fn git_diff_commit(path: String, hash: String) -> Result<String, String> {
    run_blocking(move || git_diff_commit_internal(path, hash)).await
}

#[tauri::command]
pub async fn git_log(path: String) -> Result<Vec<GitCommit>, String> {
    run_blocking(move || git_log_internal(path)).await
}

#[tauri::command]
pub async fn git_get_full_status(path: String) -> Result<GitFullStatus, String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::task::spawn_blocking(move || {
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
        }),
    )
    .await
    .map_err(|_| "git_get_full_status timed out after 5 seconds".to_string())?
    .map_err(|e| e.to_string())?
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
}
