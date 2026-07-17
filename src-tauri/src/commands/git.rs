use super::utils::create_command;
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
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    pub message: String,
    pub date: String,
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GitFullStatus {
    pub repo_path: String,
    pub is_repo: bool,
    pub files: Vec<GitFile>,
    pub commits: Vec<GitCommit>,
    pub branch: String,
}

fn git_check_is_repo_internal(path: String) -> Result<bool, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true")
}

fn git_init_internal(path: String) -> Result<(), String> {
    let output = create_command("git")
        .current_dir(&path)
        .arg("init")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_status_internal(path: String) -> Result<Vec<GitFile>, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(["status", "--porcelain=v1", "-z", "-uall"])
        .output()
        .map_err(|e| e.to_string())?;

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
        let file_path = String::from_utf8_lossy(&record[3..]).to_string();
        let name = Path::new(&file_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        if index_status != ' ' && index_status != '?' {
            files.push(GitFile {
                path: file_path.clone(),
                name: name.clone(),
                status: index_status.to_string(),
                is_staged: true,
            });
        }

        if work_tree_status != ' ' {
            let status = if index_status == '?' && work_tree_status == '?' {
                "U".to_string()
            } else {
                work_tree_status.to_string()
            };

            files.push(GitFile {
                path: file_path.clone(),
                name: name.clone(),
                status,
                is_staged: false,
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
    let output = create_command("git")
        .current_dir(&path)
        .args(["add", "--", &file])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_unstage_internal(path: String, file: String) -> Result<(), String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(["reset", "HEAD", "--", &file])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_commit_internal(path: String, message: String) -> Result<(), String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(["commit", "-m", &message])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_current_branch_internal(path: String) -> Result<String, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok("".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn git_push(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let output = create_command("git")
            .current_dir(&path)
            .arg("push")
            .output()
            .map_err(|e| e.to_string())?;

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
        let output = create_command("git")
            .current_dir(&path)
            .arg("pull")
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn git_discard_all_internal(path: String) -> Result<(), String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(["reset", "--hard", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let output = create_command("git")
        .current_dir(&path)
        .args(["clean", "-fd"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(())
}

fn git_unstage_all_internal(path: String) -> Result<(), String> {
    let output = create_command("git")
        .current_dir(&path)
        .arg("reset")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

fn git_get_remote_internal(path: String) -> Result<String, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(["remote", "get-url", "origin"])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Ok("".to_string())
    }
}

fn git_set_remote_internal(path: String, url: String) -> Result<(), String> {
    let has_remote = create_command("git")
        .current_dir(&path)
        .args(["remote", "get-url", "origin"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let output = if has_remote {
        create_command("git")
            .current_dir(&path)
            .args(["remote", "set-url", "origin", &url])
            .output()
            .map_err(|e| e.to_string())?
    } else {
        create_command("git")
            .current_dir(&path)
            .args(["remote", "add", "origin", &url])
            .output()
            .map_err(|e| e.to_string())?
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
    let output = create_command("git")
        .current_dir(&path)
        .args(["show", &hash, "--pretty=format:", "--color=never"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn git_log_internal(path: String) -> Result<Vec<GitCommit>, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args([
            "log",
            "--pretty=format:%h\x1f%an\x1f%s\x1f%ad",
            "--date=short",
            "-n",
            "50",
        ])
        .output()
        .map_err(|e| e.to_string())?;

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
                });
            }

            let files = git_status_internal(path.clone())?;
            let branch = git_current_branch_internal(path.clone())?;
            let commits = git_log_internal(path.clone())?;

            Ok::<GitFullStatus, String>(GitFullStatus {
                repo_path: path,
                is_repo: true,
                files,
                commits,
                branch,
            })
        }),
    )
    .await
    .map_err(|_| "git_get_full_status timed out after 5 seconds".to_string())?
    .map_err(|e| e.to_string())?
}
