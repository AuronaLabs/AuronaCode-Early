use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter, State};

// 任务 C：Shell 列表全局缓存，只初始化一次
static SHELL_CACHE: OnceLock<Vec<ShellProfile>> = OnceLock::new();

pub struct PtyState {
    pub writers: Mutex<HashMap<String, Box<dyn Write + Send>>>,
    pub master_ptys: Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>,
    // 任务 A：存储子进程句柄，用于 close_pty 时正确回收
    pub children: Mutex<HashMap<String, Box<dyn portable_pty::Child + Send + Sync>>>,
    // 任务 B：读线程停止标志
    pub stop_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            writers: Mutex::new(HashMap::new()),
            master_ptys: Mutex::new(HashMap::new()),
            children: Mutex::new(HashMap::new()),
            stop_flags: Mutex::new(HashMap::new()),
        }
    }
}

// Ensure orphaned PTY child processes are cleaned up when the app is shut down
impl Drop for PtyState {
    fn drop(&mut self) {
        if let Ok(mut children) = self.children.lock() {
            for (_, mut child) in children.drain() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Clone, Serialize)]
pub struct ShellProfile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub icon: String,
}

#[derive(Clone, Serialize)]
struct PtyOutputPayload {
    id: String,
    data: Vec<u8>,
}

#[tauri::command]
pub fn spawn_pty(
    id: String,
    cwd: String,
    shell_path: Option<String>,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let default_shell = "powershell.exe".to_string();
    #[cfg(not(target_os = "windows"))]
    let default_shell = "/bin/bash".to_string();

    let shell = shell_path.unwrap_or(default_shell);

    // 任务 C：通过缓存获取 shell 列表，避免重复初始化
    let allowed_shells = SHELL_CACHE.get_or_init(get_available_shells);
    let mut is_allowed = false;
    for allowed in allowed_shells {
        if allowed.path == shell {
            is_allowed = true;
            break;
        }
    }
    if !is_allowed {
        return Err(format!(
            "Security Violation: Executable {} is not an allowed shell path.",
            shell
        ));
    }

    let mut cmd = CommandBuilder::new(&shell);

    // PowerShell 添加 -NoLogo
    if shell.to_lowercase().contains("powershell") || shell.to_lowercase().contains("pwsh") {
        cmd.args(["-NoLogo"]);
    }

    cmd.cwd(cwd);

    // 任务 A：将 child 存入 PtyState
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    state.writers.lock().unwrap().insert(id.clone(), writer);
    state.master_ptys.lock().unwrap().insert(id.clone(), pair.master);
    state.children.lock().unwrap().insert(id.clone(), child);

    // 任务 B：创建停止标志并传入读线程
    let stop_flag = Arc::new(AtomicBool::new(false));
    state.stop_flags.lock().unwrap().insert(id.clone(), Arc::clone(&stop_flag));

    let id_clone = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            // 检查停止标志
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let payload = PtyOutputPayload {
                        id: id_clone.clone(),
                        data: buf[..n].to_vec(),
                    };
                    let _ = app.emit("pty-output", payload);
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn write_pty(id: String, data: String, state: State<'_, PtyState>) -> Result<(), String> {
    // 任务 D：正确传播写入错误
    if let Some(writer) = state.writers.lock().unwrap().get_mut(&id) {
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("PTY write error: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn resize_pty(
    id: String,
    rows: u16,
    cols: u16,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    if let Some(master) = state.master_ptys.lock().unwrap().get_mut(&id) {
        let _ = master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn close_pty(id: String, state: State<'_, PtyState>) -> Result<(), String> {
    // 任务 B：设置停止标志，通知读线程退出
    if let Some(flag) = state.stop_flags.lock().unwrap().remove(&id) {
        flag.store(true, Ordering::Relaxed);
    }

    // 先释放 writer，关闭写端
    state.writers.lock().unwrap().remove(&id);
    // 释放 master PTY
    state.master_ptys.lock().unwrap().remove(&id);

    // 任务 A：取出子进程，kill 并 wait，避免孤儿进程
    if let Some(mut child) = state.children.lock().unwrap().remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }

    Ok(())
}

#[tauri::command]
pub fn get_available_shells() -> Vec<ShellProfile> {
    let mut shells = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // 1. Windows PowerShell
        shells.push(ShellProfile {
            id: "powershell".to_string(),
            name: "PowerShell".to_string(),
            path: "powershell.exe".to_string(),
            icon: "powershell".to_string(),
        });

        // 2. PowerShell Core (pwsh)
        if std::process::Command::new("pwsh.exe").arg("-Version").output().is_ok() {
            shells.push(ShellProfile {
                id: "pwsh".to_string(),
                name: "PowerShell Core".to_string(),
                path: "pwsh.exe".to_string(),
                icon: "powershell".to_string(),
            });
        }

        // 3. Command Prompt
        shells.push(ShellProfile {
            id: "cmd".to_string(),
            name: "Command Prompt".to_string(),
            path: "cmd.exe".to_string(),
            icon: "terminal".to_string(),
        });

        // 4. Git Bash
        let git_bash_path = "C:\\Program Files\\Git\\bin\\bash.exe";
        if std::path::Path::new(git_bash_path).exists() {
            shells.push(ShellProfile {
                id: "git-bash".to_string(),
                name: "Git Bash".to_string(),
                path: git_bash_path.to_string(),
                icon: "git".to_string(),
            });
        }

        // 5. WSL
        if std::process::Command::new("wsl.exe").arg("--version").output().is_ok()
            || std::path::Path::new("C:\\Windows\\System32\\wsl.exe").exists()
        {
            shells.push(ShellProfile {
                id: "wsl".to_string(),
                name: "WSL".to_string(),
                path: "wsl.exe".to_string(),
                icon: "linux".to_string(),
            });
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        shells.push(ShellProfile {
            id: "bash".to_string(),
            name: "Bash".to_string(),
            path: "/bin/bash".to_string(),
            icon: "terminal".to_string(),
        });

        shells.push(ShellProfile {
            id: "zsh".to_string(),
            name: "Zsh".to_string(),
            path: "/bin/zsh".to_string(),
            icon: "terminal".to_string(),
        });

        shells.push(ShellProfile {
            id: "sh".to_string(),
            name: "Shell".to_string(),
            path: "/bin/sh".to_string(),
            icon: "terminal".to_string(),
        });
    }

    shells
}
