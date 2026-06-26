use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::Path;

mod pty;
mod search;
mod lsp;

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

#[derive(Serialize, Deserialize)]
pub struct GitFullStatus {
    pub repo_path: String,
    pub is_repo: bool,
    pub files: Vec<GitFile>,
    pub commits: Vec<GitCommit>,
    pub branch: String,
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
fn git_check_is_repo(path: String) -> Result<bool, String> {
    let git_dir = Path::new(&path).join(".git");
    Ok(git_dir.exists() && git_dir.is_dir())
}

#[tauri::command]
fn git_init(path: String) -> Result<(), String> {
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
fn git_status(path: String) -> Result<Vec<GitFile>, String> {
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
fn git_add(path: String, file: String) -> Result<(), String> {
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
fn git_unstage(path: String, file: String) -> Result<(), String> {
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
fn git_commit(path: String, message: String) -> Result<(), String> {
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
fn git_current_branch(path: String) -> Result<String, String> {
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
fn git_push(path: String) -> Result<(), String> {
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
fn git_pull(path: String) -> Result<(), String> {
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
fn git_discard_all(path: String) -> Result<(), String> {
    // 1. Reset staged changes
    let output = create_command("git")
        .current_dir(&path)
        .args(&["reset", "--hard", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;
        
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    
    // 2. Clean untracked files
    let output = create_command("git")
        .current_dir(&path)
        .args(&["clean", "-fd"])
        .output()
        .map_err(|e| e.to_string())?;
        
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
        
    Ok(())
}

#[tauri::command]
fn git_unstage_all(path: String) -> Result<(), String> {
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
fn git_get_remote(path: String) -> Result<String, String> {
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
fn git_set_remote(path: String, url: String) -> Result<(), String> {
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
fn git_log(path: String) -> Result<Vec<GitCommit>, String> {
    let output = create_command("git")
        .current_dir(&path)
        .args(&["log", "--pretty=format:%h\x1f%an\x1f%s\x1f%ad", "--date=short", "-n", "50"])
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

// 任务 H：改为 async 并加 tokio::time::timeout（5秒）防止 git 命令挂起
#[tauri::command]
async fn git_get_full_status(path: String) -> Result<GitFullStatus, String> {
    // 整体超时 5 秒
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        async {
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

            // 任务 I：失败时打印错误日志，而非静默吞掉
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

            Ok(GitFullStatus {
                repo_path: path,
                is_repo: true,
                files,
                commits,
                branch,
            })
        },
    )
    .await
    .map_err(|_| "git_get_full_status timed out after 5 seconds".to_string())?
}

struct LspState {
    clients: tokio::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<lsp::LspClient>>>,
}

// 任务 J：lsp_start 接收 AppHandle，版本号从 package_info() 动态读取
#[tauri::command]
async fn lsp_start(
    language: String,
    command: String,
    args: Vec<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, LspState>,
) -> Result<(), String> {
    let mut clients = state.clients.lock().await;
    if clients.contains_key(&language) {
        return Ok(()); // 已在运行中
    }

    // 任务 J：从 AppHandle 的 package_info() 读取版本号，避免硬编码
    let version = app_handle.package_info().version.to_string();

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let client = lsp::LspClient::start(&command, &args_ref, app_handle.clone()).await?;

    // 发送 initialize 请求
    let init_params = serde_json::json!({
        "processId": std::process::id(),
        "clientInfo": { "name": "Aurona Code", "version": version },
        "rootUri": null,
        "capabilities": {
            "textDocument": {
                "hover": {
                    "dynamicRegistration": true,
                    "contentFormat": ["markdown", "plaintext"]
                },
                "synchronization": {
                    "dynamicRegistration": true,
                    "willSave": false,
                    "willSaveWaitUntil": false,
                    "didSave": true
                }
            }
        }
    });

    let _ = client.call("initialize", init_params).await?;
    let _ = client.notify("initialized", serde_json::json!({})).await?;

    clients.insert(language, std::sync::Arc::new(client));
    Ok(())
}

#[tauri::command]
async fn lsp_did_open(
    language: String,
    path: String,
    text: String,
    version: i32,
    state: tauri::State<'_, LspState>,
) -> Result<(), String> {
    let clients = state.clients.lock().await;
    if let Some(client) = clients.get(&language) {
        let uri = format!("file:///{}", path.replace('\\', "/"));
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "languageId": language,
                "version": version,
                "text": text
            }
        });
        client.notify("textDocument/didOpen", params).await?;
    }
    Ok(())
}

#[tauri::command]
async fn lsp_did_change(
    language: String,
    path: String,
    text: String,
    version: i32,
    state: tauri::State<'_, LspState>,
) -> Result<(), String> {
    let clients = state.clients.lock().await;
    if let Some(client) = clients.get(&language) {
        let uri = format!("file:///{}", path.replace('\\', "/"));
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "version": version
            },
            "contentChanges": [{
                "text": text
            }]
        });
        client.notify("textDocument/didChange", params).await?;
    }
    Ok(())
}

#[tauri::command]
async fn lsp_did_close(
    language: String,
    path: String,
    state: tauri::State<'_, LspState>,
) -> Result<(), String> {
    let clients = state.clients.lock().await;
    if let Some(client) = clients.get(&language) {
        let uri = format!("file:///{}", path.replace('\\', "/"));
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
            }
        });
        client.notify("textDocument/didClose", params).await?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(pty::PtyState::new())
        .manage(LspState {
            clients: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        })
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
            git_get_full_status,
            pty::spawn_pty,
            pty::close_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::get_available_shells,
            search::search_workspace,
            lsp_start,
            lsp_did_open,
            lsp_did_change,
            lsp_did_close,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Aurona Code");
}
