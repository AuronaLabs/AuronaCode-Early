use base64::prelude::*;
use dashmap::DashMap;
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter, State};
use ts_rs::TS;

static SHELL_CACHE: OnceLock<Vec<ShellProfile>> = OnceLock::new();

struct PtySession {
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    closed: AtomicBool,
}

impl PtySession {
    fn shutdown(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        self.writer.lock().ok().and_then(|mut writer| writer.take());
        self.master.lock().ok().and_then(|mut master| master.take());
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut child) = child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub struct PtyState {
    sessions: Arc<DashMap<String, Arc<PtySession>>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
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

#[derive(Clone, Serialize)]
struct PtyExitPayload {
    id: String,
    reason: String,
}

fn available_shells() -> &'static Vec<ShellProfile> {
    SHELL_CACHE.get_or_init(get_available_shells)
}

fn shell_command(shell_path: Option<String>) -> Result<(String, CommandBuilder), String> {
    #[cfg(target_os = "windows")]
    let default_shell = "powershell.exe";
    #[cfg(not(target_os = "windows"))]
    let default_shell = default_unix_shell();

    let shell = shell_path.unwrap_or_else(|| default_shell.to_string());
    let profile = available_shells()
        .iter()
        .find(|profile| profile.path.eq_ignore_ascii_case(&shell))
        .ok_or_else(|| format!("Unsupported terminal shell: {shell}"))?;

    let mut command = CommandBuilder::new(&profile.path);
    match profile.id.as_str() {
        "powershell" | "pwsh" => command.args(["-NoLogo"]),
        "git-bash" => command.args(["--login", "-i"]),
        "bash" | "zsh" | "fish" => command.args(["--login"]),
        _ => {}
    }
    Ok((profile.name.clone(), command))
}

#[tauri::command]
pub fn spawn_pty(
    id: String,
    cwd: String,
    shell_path: Option<String>,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("Terminal id cannot be empty".to_string());
    }
    // 幂等处理：如果旧会话存在，先静默清理再创建新的
    // 这保证了 React StrictMode 的双重挂载不会导致冲突
    if let Some((_, old_session)) = state.sessions.remove(&id) {
        old_session.shutdown();
    }
    if !Path::new(&cwd).is_dir() {
        return Err(format!("Terminal working directory does not exist: {cwd}"));
    }

    let (shell_name, mut command) = shell_command(shell_path)?;
    command.cwd(&cwd);

    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Unable to allocate PTY: {error}"))?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Unable to start {shell_name}: {error}"))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Unable to create PTY reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Unable to create PTY writer: {error}"))?;

    let session = Arc::new(PtySession {
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(Some(pair.master)),
        child: Mutex::new(Some(child)),
        closed: AtomicBool::new(false),
    });
    state.sessions.insert(id.clone(), Arc::clone(&session));

    let sessions = Arc::clone(&state.sessions);
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let reason = loop {
            match reader.read(&mut buffer) {
                Ok(0) => break "terminal process exited".to_string(),
                Ok(count) => {
                    let payload = PtyOutputPayload {
                        id: id.clone(),
                        data: BASE64_STANDARD.encode(&buffer[..count]),
                    };
                    if app.emit("pty-output", payload).is_err() {
                        break "terminal event channel closed".to_string();
                    }
                }
                Err(_error) if session.closed.load(Ordering::SeqCst) => {
                    break "terminal closed".to_string();
                }
                Err(error) => break format!("terminal read failed: {error}"),
            }
        };

        // 仅当 map 中仍是本会话时才清理并关闭：防止旧 reader 线程退出时误杀同 id 的新会话
        if let Some((_, removed)) =
            sessions.remove_if(&id, |_, current| Arc::ptr_eq(current, &session))
        {
            removed.shutdown();
        }
        let _ = app.emit("pty-exit", PtyExitPayload { id, reason });
    });

    Ok(())
}

#[tauri::command]
pub fn write_pty(id: String, data: String, state: State<'_, PtyState>) -> Result<(), String> {
    let session = state
        .sessions
        .get(&id)
        .map(|entry| Arc::clone(entry.value()))
        .ok_or_else(|| format!("Terminal session {id} is not running"))?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| format!("Terminal session {id} writer is unavailable"))?;
    let writer = writer
        .as_mut()
        .ok_or_else(|| format!("Terminal session {id} is closed"))?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("Terminal write failed: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Terminal flush failed: {error}"))
}

#[tauri::command]
pub fn resize_pty(
    id: String,
    rows: u16,
    cols: u16,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    if rows == 0 || cols == 0 {
        return Ok(());
    }
    let session = state
        .sessions
        .get(&id)
        .map(|entry| Arc::clone(entry.value()))
        .ok_or_else(|| format!("Terminal session {id} is not running"))?;
    let master = session
        .master
        .lock()
        .map_err(|_| format!("Terminal session {id} resize handle is unavailable"))?;
    let master = master
        .as_ref()
        .ok_or_else(|| format!("Terminal session {id} is closed"))?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Terminal resize failed: {error}"))
}

#[tauri::command]
pub fn close_pty(id: String, state: State<'_, PtyState>) -> Result<(), String> {
    if let Some((_, session)) = state.sessions.remove(&id) {
        session.shutdown();
    }
    Ok(())
}

#[tauri::command]
pub fn get_available_shells() -> Vec<ShellProfile> {
    let mut shells = Vec::new();

    #[cfg(target_os = "windows")]
    {
        shells.push(ShellProfile {
            id: "powershell".to_string(),
            name: "PowerShell".to_string(),
            path: "powershell.exe".to_string(),
            icon: "powershell".to_string(),
        });
        shells.push(ShellProfile {
            id: "cmd".to_string(),
            name: "Command Prompt".to_string(),
            path: "cmd.exe".to_string(),
            icon: "terminal".to_string(),
        });

        if command_exists("pwsh.exe", "-Version") {
            shells.push(ShellProfile {
                id: "pwsh".to_string(),
                name: "PowerShell Core".to_string(),
                path: "pwsh.exe".to_string(),
                icon: "powershell".to_string(),
            });
        }
        let git_bash = "C:\\Program Files\\Git\\bin\\bash.exe";
        if Path::new(git_bash).is_file() {
            shells.push(ShellProfile {
                id: "git-bash".to_string(),
                name: "Git Bash".to_string(),
                path: git_bash.to_string(),
                icon: "git".to_string(),
            });
        }
        if Path::new("C:\\Windows\\System32\\wsl.exe").is_file()
            || command_exists("wsl.exe", "--version")
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
    shells.extend(discover_unix_shells());

    shells
}

#[cfg(unix)]
fn default_unix_shell() -> &'static str {
    available_shells()
        .first()
        .map(|profile| profile.path.as_str())
        .unwrap_or("/bin/sh")
}

#[cfg(unix)]
fn discover_unix_shells() -> Vec<ShellProfile> {
    let mut candidates = Vec::new();
    if let Ok(shell) = std::env::var("SHELL") {
        candidates.push(shell);
    }
    if let Ok(contents) = std::fs::read_to_string("/etc/shells") {
        candidates.extend(
            contents
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && !line.starts_with('#'))
                .map(str::to_string),
        );
    }
    #[cfg(target_os = "macos")]
    candidates.extend(["/bin/zsh".to_string(), "/bin/bash".to_string()]);
    #[cfg(target_os = "linux")]
    candidates.extend([
        "/bin/bash".to_string(),
        "/usr/bin/bash".to_string(),
        "/bin/zsh".to_string(),
        "/usr/bin/zsh".to_string(),
        "/usr/bin/fish".to_string(),
        "/bin/dash".to_string(),
        "/bin/sh".to_string(),
    ]);

    let mut seen_paths = std::collections::HashSet::new();
    let mut seen_shells = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen_paths.insert(path.clone()))
        .filter(|path| Path::new(path).is_file())
        .filter_map(|path| {
            let id = Path::new(&path).file_name()?.to_str()?.to_ascii_lowercase();
            let name = match id.as_str() {
                "bash" => "Bash",
                "zsh" => "Zsh",
                "fish" => "Fish",
                "dash" => "Dash",
                "sh" => "Shell",
                _ => return None,
            };
            if !seen_shells.insert(id.clone()) {
                return None;
            }
            Some(ShellProfile {
                id,
                name: name.to_string(),
                path,
                icon: "terminal".to_string(),
            })
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn command_exists(command: &str, argument: &str) -> bool {
    use std::os::windows::process::CommandExt;
    std::process::Command::new(command)
        .arg(argument)
        .creation_flags(0x08000000)
        .output()
        .is_ok()
}
