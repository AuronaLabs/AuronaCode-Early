use base64::prelude::*;
use dashmap::DashMap;
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};
use ts_rs::TS;

static SHELL_CACHE: OnceLock<Vec<ShellProfile>> = OnceLock::new();

struct PtySession {
    session_id: String,
    generation: u64,
    output: OutputWindow,
    #[cfg(windows)]
    job: Mutex<crate::process_service::WindowsJob>,
    #[cfg(unix)]
    process_group: i32,
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
        self.output.close();
        #[cfg(windows)]
        if let Ok(mut job) = self.job.lock() {
            job.terminate();
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(-self.process_group, libc::SIGKILL);
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

#[derive(Default)]
struct OutputWindow {
    state: Mutex<(u64, std::collections::VecDeque<u64>, bool)>,
    wake: Condvar,
}

impl OutputWindow {
    fn reserve(&self) -> Option<u64> {
        let mut state = self.state.lock().ok()?;
        while !state.2 && state.1.len() >= 4 {
            state = self.wake.wait(state).ok()?;
        }
        if state.2 {
            return None;
        }
        state.0 += 1;
        let seq = state.0;
        state.1.push_back(seq);
        Some(seq)
    }
    fn acknowledge(&self, seq: u64) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(index) = state.1.iter().position(|pending| *pending == seq) {
                state.1.remove(index);
                self.wake.notify_all();
            }
        }
    }
    fn close(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.2 = true;
            self.wake.notify_all();
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
    launch_lock: Mutex<()>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            launch_lock: Mutex::new(()),
        }
    }
}

pub fn close_workspace_sessions(app: &AppHandle, state: &PtyState, generation: u64) {
    let _launch = match state.launch_lock.lock() {
        Ok(lock) => lock,
        Err(_) => return,
    };
    let ids = state
        .sessions
        .iter()
        .filter(|entry| entry.generation <= generation)
        .map(|entry| entry.key().clone())
        .collect::<Vec<_>>();
    for id in ids {
        if let Some((_, session)) = state.sessions.remove(&id) {
            session.shutdown();
            let _ = app.emit(
                "pty-exit",
                PtyExitPayload {
                    id,
                    session_id: session.session_id.clone(),
                    reason: "workspace changed".into(),
                },
            );
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
    session_id: String,
    seq: u64,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExitPayload {
    id: String,
    session_id: String,
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
    session_id: String,
    cwd: String,
    shell_path: Option<String>,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    if id.trim().is_empty() || id.len() > 128 || session_id.is_empty() || session_id.len() > 128 {
        return Err("Terminal id cannot be empty".to_string());
    }
    let _launch = state.launch_lock.lock().map_err(|e| e.to_string())?;
    let workspace = app.state::<crate::commands::fs::WorkspaceState>();
    let generation = workspace.generation();
    let cwd = workspace.require_directory(&cwd)?;
    if !state.sessions.contains_key(&id)
        && state.sessions.len() >= crate::resource_limits::PTY_SESSIONS
    {
        return Err("[resource.limit] Terminal session limit reached".into());
    }
    // 幂等处理：如果旧会话存在，先静默清理再创建新的
    // 这保证了 React StrictMode 的双重挂载不会导致冲突
    if let Some((_, old_session)) = state.sessions.remove(&id) {
        old_session.shutdown();
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
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Unable to start {shell_name}: {error}"))?;
    let process_id = child
        .process_id()
        .ok_or("Terminal process ID unavailable")?;
    #[cfg(windows)]
    let job = match crate::process_service::WindowsJob::attach(process_id) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Unable to create PTY reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Unable to create PTY writer: {error}"))?;

    let session = Arc::new(PtySession {
        session_id: session_id.clone(),
        generation,
        output: OutputWindow::default(),
        #[cfg(windows)]
        job: Mutex::new(job),
        #[cfg(unix)]
        process_group: process_id as i32,
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(Some(pair.master)),
        child: Mutex::new(Some(child)),
        closed: AtomicBool::new(false),
    });
    if workspace.generation() != generation {
        session.shutdown();
        return Err("[workspace.generation] Workspace changed while starting terminal".into());
    }
    state.sessions.insert(id.clone(), Arc::clone(&session));

    let (sender, receiver) = std::sync::mpsc::sync_channel::<Result<Vec<u8>, String>>(8);
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if sender.send(Ok(buffer[..count].to_vec())).is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => {
                    let _ = sender.send(Err(error.to_string()));
                    break;
                }
            }
        }
    });
    let sessions = Arc::clone(&state.sessions);
    thread::spawn(move || {
        let reason = loop {
            let mut batch = match receiver.recv() {
                Ok(Ok(bytes)) => bytes,
                Ok(Err(error)) => break format!("terminal read failed: {error}"),
                Err(_) => break "terminal process exited".to_string(),
            };
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(16);
            while batch.len() < 56 * 1024 {
                match receiver
                    .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                {
                    Ok(Ok(bytes)) => batch.extend(bytes),
                    Ok(Err(_)) | Err(_) => break,
                }
            }
            let Some(seq) = session.output.reserve() else {
                break "terminal closed".into();
            };
            let payload = PtyOutputPayload {
                id: id.clone(),
                session_id: session_id.clone(),
                seq,
                data: BASE64_STANDARD.encode(&batch),
            };
            if app.emit("pty-output", payload).is_err() {
                break "terminal event channel closed".into();
            }
        };

        // 仅当 map 中仍是本会话时才清理并关闭：防止旧 reader 线程退出时误杀同 id 的新会话
        if let Some((_, removed)) =
            sessions.remove_if(&id, |_, current| Arc::ptr_eq(current, &session))
        {
            removed.shutdown();
        }
        let _ = app.emit(
            "pty-exit",
            PtyExitPayload {
                id,
                session_id,
                reason,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn acknowledge_pty(id: String, session_id: String, seq: u64, state: State<'_, PtyState>) {
    if let Some(session) = state.sessions.get(&id) {
        if session.session_id == session_id {
            session.output.acknowledge(seq);
        }
    }
}

#[tauri::command]
pub fn write_pty(id: String, data: String, state: State<'_, PtyState>) -> Result<(), String> {
    if data.len() > crate::resource_limits::PTY_INPUT_BYTES {
        return Err("[resource.limit] Terminal input exceeds 64 KiB".into());
    }
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
pub fn close_pty(
    id: String,
    session_id: Option<String>,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    if let Some((_, session)) = state.sessions.remove_if(&id, |_, session| {
        session_id
            .as_ref()
            .is_none_or(|id| *id == session.session_id)
    }) {
        session.shutdown();
    }
    Ok(())
}

#[cfg(test)]
mod output_tests {
    use super::*;
    #[test]
    fn output_window_blocks_at_four_and_close_releases_waiters() {
        let window = Arc::new(OutputWindow::default());
        for seq in 1..=4 {
            assert_eq!(window.reserve(), Some(seq));
        }
        window.acknowledge(500);
        assert_eq!(window.state.lock().unwrap().1.len(), 4);
        let cloned = window.clone();
        let waiting = thread::spawn(move || cloned.reserve());
        window.acknowledge(2);
        assert_eq!(waiting.join().unwrap(), Some(5));
        window.acknowledge(2);
        assert_eq!(window.state.lock().unwrap().1.len(), 4);
        let cloned = window.clone();
        let waiting = thread::spawn(move || cloned.reserve());
        window.close();
        assert_eq!(waiting.join().unwrap(), None);
    }
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
