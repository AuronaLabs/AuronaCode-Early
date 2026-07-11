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

#[tauri::command]
pub fn git_check_is_repo(path: String) -> Result<bool, String> {
    let git_dir = Path::new(&path).join(".git");
    Ok(git_dir.exists() && git_dir.is_dir())
}

#[tauri::command]
pub fn git_init(path: String) -> Result<(), String> {
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

#[tauri::command]
pub fn git_status(path: String) -> Result<Vec<GitFile>, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(["status", "--porcelain", "-uall"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let out_str = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();

    for line in out_str.lines() {
        if line.len() < 4 {
            continue;
        }

        let chars: Vec<char> = line.chars().collect();
        let index_status = chars[0];
        let work_tree_status = chars[1];
        let file_path = line[3..].trim().to_string();
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
    }

    Ok(files)
}

#[tauri::command]
pub fn git_add(path: String, file: String) -> Result<(), String> {
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

#[tauri::command]
pub fn git_unstage(path: String, file: String) -> Result<(), String> {
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

#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<(), String> {
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

#[tauri::command]
pub fn git_current_branch(path: String) -> Result<String, String> {
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

#[tauri::command]
pub fn git_discard_all(path: String) -> Result<(), String> {
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

#[tauri::command]
pub fn git_unstage_all(path: String) -> Result<(), String> {
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

#[tauri::command]
pub fn git_get_remote(path: String) -> Result<String, String> {
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

#[tauri::command]
pub fn git_set_remote(path: String, url: String) -> Result<(), String> {
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

#[tauri::command]
pub fn git_diff_commit(path: String, hash: String) -> Result<String, String> {
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

#[tauri::command]
pub fn git_log(path: String) -> Result<Vec<GitCommit>, String> {
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
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
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
pub async fn git_get_full_status(path: String) -> Result<GitFullStatus, String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::task::spawn_blocking(move || {
            let is_repo = git_check_is_repo(path.clone())?;
            if !is_repo {
                return Ok(GitFullStatus {
                    repo_path: path.clone(),
                    is_repo: false,
                    files: vec![],
                    commits: vec![],
                    branch: "".to_string(),
                });
            }

            let files = git_status(path.clone()).unwrap_or_else(|e| {
                eprintln!("git sub-command failed: {:?}", e);
                vec![]
            });
            let branch = git_current_branch(path.clone()).unwrap_or_else(|e| {
                eprintln!("git sub-command failed: {:?}", e);
                String::new()
            });
            let commits = git_log(path.clone()).unwrap_or_else(|e| {
                eprintln!("git sub-command failed: {:?}", e);
                vec![]
            });

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
