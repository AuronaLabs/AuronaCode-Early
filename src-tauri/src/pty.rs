use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, State};

pub struct PtyState {
    pub writers: Mutex<HashMap<String, Box<dyn Write + Send>>>,
    pub master_ptys: Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            writers: Mutex::new(HashMap::new()),
            master_ptys: Mutex::new(HashMap::new()),
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

    let default_shell = "powershell.exe".to_string();
    let shell = shell_path.unwrap_or(default_shell);
    let mut cmd = CommandBuilder::new(&shell);
    
    // Add -NoLogo if it's PowerShell
    if shell.to_lowercase().contains("powershell") || shell.to_lowercase().contains("pwsh") {
        cmd.args(["-NoLogo"]);
    }
    
    cmd.cwd(cwd);

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    state.writers.lock().unwrap().insert(id.clone(), writer);
    state.master_ptys.lock().unwrap().insert(id.clone(), pair.master);

    let id_clone = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let payload = PtyOutputPayload {
                id: id_clone.clone(),
                data: buf[..n].to_vec(),
            };
            let _ = app.emit("pty-output", payload);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn write_pty(id: String, data: String, state: State<'_, PtyState>) -> Result<(), String> {
    if let Some(writer) = state.writers.lock().unwrap().get_mut(&id) {
        let _ = writer.write_all(data.as_bytes());
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
pub fn get_available_shells() -> Vec<ShellProfile> {
    let mut shells = Vec::new();

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
    if std::process::Command::new("wsl.exe").arg("--version").output().is_ok() || 
       std::path::Path::new("C:\\Windows\\System32\\wsl.exe").exists() {
        shells.push(ShellProfile {
            id: "wsl".to_string(),
            name: "WSL".to_string(),
            path: "wsl.exe".to_string(),
            icon: "linux".to_string(),
        });
    }

    shells
}
