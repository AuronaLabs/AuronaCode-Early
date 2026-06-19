use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::Path;

mod pty;

#[derive(Serialize, Deserialize, Clone)]
pub struct GitFile {
    pub path: String,
    pub name: String,
    pub status: String,
    pub is_staged: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    pub message: String,
    pub date: String,
}

fn create_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[tauri::command]
async fn git_check_is_repo(path: String) -> Result<bool, String> {
    let git_dir = Path::new(&path).join(".git");
    Ok(git_dir.exists() && git_dir.is_dir())
}

#[tauri::command]
async fn git_init(path: String) -> Result<(), String> {
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
async fn git_status(path: String) -> Result<Vec<GitFile>, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(&["status", "--porcelain", "-uall"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let out_str = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();

    for line in out_str.lines() {
        if line.len() < 4 { continue; }
        
        let chars: Vec<char> = line.chars().collect();
        let index_status = chars[0];
        let work_tree_status = chars[1];
        let file_path = line[3..].trim().to_string();
        let name = Path::new(&file_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        // Process Staged part (index)
        if index_status != ' ' && index_status != '?' {
            files.push(GitFile {
                path: file_path.clone(),
                name: name.clone(),
                status: index_status.to_string(),
                is_staged: true,
            });
        }

        // Process Unstaged part (work tree)
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
async fn git_add(path: String, file: String) -> Result<(), String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(&["add", &file])
        .output()
        .map_err(|e| e.to_string())?;
        
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
async fn git_unstage(path: String, file: String) -> Result<(), String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(&["reset", "HEAD", "--", &file])
        .output()
        .map_err(|e| e.to_string())?;
        
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
async fn git_commit(path: String, message: String) -> Result<(), String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(&["commit", "-m", &message])
        .output()
        .map_err(|e| e.to_string())?;
        
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
async fn git_current_branch(path: String) -> Result<String, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(&["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;
        
    if !output.status.success() {
        return Ok("".to_string()); // If no branch yet or error, return empty string
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
async fn git_push(path: String) -> Result<(), String> {
    let output = create_command("git")
        .current_dir(&path)
        .arg("push")
        .output()
        .map_err(|e| e.to_string())?;
        
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
async fn git_pull(path: String) -> Result<(), String> {
    let output = create_command("git")
        .current_dir(&path)
        .arg("pull")
        .output()
        .map_err(|e| e.to_string())?;
        
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
async fn git_discard_all(path: String) -> Result<(), String> {
    // 1. Reset staged changes
    let _ = create_command("git")
        .current_dir(&path)
        .args(&["reset", "HEAD", "--hard"])
        .output();
    
    // 2. Clean untracked files
    let _ = create_command("git")
        .current_dir(&path)
        .args(&["clean", "-fd"])
        .output();
        
    Ok(())
}

#[tauri::command]
async fn git_unstage_all(path: String) -> Result<(), String> {
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
async fn git_get_remote(path: String) -> Result<String, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(&["remote", "get-url", "origin"])
        .output()
        .map_err(|e| e.to_string())?;
        
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Ok("".to_string()) // No remote origin configured
    }
}

#[tauri::command]
async fn git_set_remote(path: String, url: String) -> Result<(), String> {
    // Check if remote exists first
    let has_remote = create_command("git")
        .current_dir(&path)
        .args(&["remote", "get-url", "origin"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let output = if has_remote {
        create_command("git")
            .current_dir(&path)
            .args(&["remote", "set-url", "origin", &url])
            .output()
            .map_err(|e| e.to_string())?
    } else {
        create_command("git")
            .current_dir(&path)
            .args(&["remote", "add", "origin", &url])
            .output()
            .map_err(|e| e.to_string())?
    };

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
async fn git_log(path: String) -> Result<Vec<GitCommit>, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(&["log", "--pretty=format:%h|%an|%s|%ad", "--date=short", "-n", "50"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let out_str = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();

    for line in out_str.lines() {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(pty::PtyState::new())
        .invoke_handler(tauri::generate_handler![
            git_check_is_repo,
            git_init,
            git_status,
            git_add,
            git_unstage,
            git_commit,
            git_current_branch,
            git_push,
            git_pull,
            git_discard_all,
            git_unstage_all,
            git_get_remote,
            git_set_remote,
            git_log,
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::get_available_shells,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aurona Code");
}
