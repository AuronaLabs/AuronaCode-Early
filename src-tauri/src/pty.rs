use base64::prelude::*;
use dashmap::DashMap;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter, State};
use ts_rs::TS;

// 任务 C：Shell 列表全局缓存，只初始化一次
static SHELL_CACHE: OnceLock<Vec<ShellProfile>> = OnceLock::new();

pub struct PtyState {
    pub writers: DashMap<String, Mutex<Box<dyn Write + Send>>>,
    pub master_ptys: DashMap<String, Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    // 任务 A：存储子进程句柄，用于 close_pty 时正确回收
    pub children: DashMap<String, Box<dyn portable_pty::Child + Send + Sync>>,
    // 任务 B：读线程停止标志
    pub stop_flags: DashMap<String, Arc<AtomicBool>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            writers: DashMap::new(),
            master_ptys: DashMap::new(),
            children: DashMap::new(),
            stop_flags: DashMap::new(),
        }
    }
}

// Ensure orphaned PTY child processes are cleaned up when the app is shut down
impl Drop for PtyState {
    fn drop(&mut self) {
        for mut child in self.children.iter_mut() {
            let _ = child.value_mut().kill();
            let _ = child.value_mut().wait();
        }
    }
}

#[derive(Clone, Serialize, TS)]
#[ts(export)]
pub struct ShellProfile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub icon: String,
}

#[derive(Clone, Serialize)]
struct PtyOutputPayload {
    id: String,
    data: String,
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

    state.writers.insert(id.clone(), Mutex::new(writer));
    state
        .master_ptys
        .insert(id.clone(), Mutex::new(pair.master));
    state.children.insert(id.clone(), child);

    // 任务 B：创建停止标志并传入读线程
    let stop_flag = Arc::new(AtomicBool::new(false));
    state.stop_flags.insert(id.clone(), Arc::clone(&stop_flag));

    let id_clone = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut buffer = Vec::new();
        let mut last_emit = std::time::Instant::now();
        loop {
            // 检查停止标志
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => {
                    if !buffer.is_empty() {
                        let payload = PtyOutputPayload {
                            id: id_clone.clone(),
                            data: BASE64_STANDARD.encode(&buffer),
                        };
                        let _ = app.emit("pty-output", payload);
                    }
                    break;
                }
                Ok(n) => {
                    buffer.extend_from_slice(&buf[..n]);
                    if buffer.len() > 4096
                        || last_emit.elapsed() >= std::time::Duration::from_millis(16)
                    {
                        let payload = PtyOutputPayload {
                            id: id_clone.clone(),
                            data: BASE64_STANDARD.encode(&buffer),
                        };
                        let _ = app.emit("pty-output", payload);
                        buffer.clear();
                        last_emit = std::time::Instant::now();
                    }
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
    if let Some(writer_mutex) = state.writers.get(&id) {
        if let Ok(mut writer) = writer_mutex.lock() {
            writer
                .write_all(data.as_bytes())
                .map_err(|e| format!("PTY write error: {}", e))?;
        }
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
    if let Some(master_mutex) = state.master_ptys.get(&id) {
        if let Ok(master) = master_mutex.lock() {
            let _ = master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn close_pty(id: String, state: State<'_, PtyState>) -> Result<(), String> {
    // 任务 B：设置停止标志，通知读线程退出
    if let Some(flag) = state.stop_flags.remove(&id) {
        flag.1.store(true, Ordering::Relaxed);
    }

    // 先释放 writer，关闭写端
    state.writers.remove(&id);
    // 释放 master PTY
    state.master_ptys.remove(&id);

    // 任务 A：取出子进程，kill 并 wait，避免孤儿进程
    if let Some(mut child) = state.children.remove(&id) {
        let _ = child.1.kill();
        let _ = child.1.wait();
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
        let mut pwsh_cmd = std::process::Command::new("pwsh.exe");
        pwsh_cmd.arg("-Version");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            pwsh_cmd.creation_flags(0x08000000);
        }

        if pwsh_cmd.output().is_ok() {
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
        let mut wsl_cmd = std::process::Command::new("wsl.exe");
        wsl_cmd.arg("--version");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            wsl_cmd.creation_flags(0x08000000);
        }

        if wsl_cmd.output().is_ok()
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
