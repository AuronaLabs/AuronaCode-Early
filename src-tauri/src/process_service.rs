use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Child;

/// Creates a child process that never opens a console window on Windows.
#[allow(unused_mut)]
pub fn create_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// A long-lived managed child (LSP/DAP adapters) that is terminated together
/// with its whole process tree when stopped, times out, or is dropped.
pub struct ManagedChild {
    child: Child,
    #[cfg(windows)]
    job: WindowsJob,
    #[cfg(unix)]
    process_group: i32,
}

impl ManagedChild {
    pub fn configure(command: &mut tokio::process::Command) {
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(not(unix))]
        let _ = command;
    }

    #[allow(unused_mut)]
    pub fn attach(mut child: Child) -> Result<Self, String> {
        #[cfg(windows)]
        {
            let process_id = child
                .id()
                .ok_or_else(|| "Spawned process does not expose a process id".to_string())?;
            match WindowsJob::attach(process_id) {
                Ok(job) => Ok(Self { child, job }),
                Err(error) => {
                    let _ = child.start_kill();
                    Err(error)
                }
            }
        }
        #[cfg(not(windows))]
        {
            #[cfg(unix)]
            {
                let process_group = child
                    .id()
                    .and_then(|id| i32::try_from(id).ok())
                    .ok_or_else(|| {
                        "Spawned process does not expose a valid process id".to_string()
                    })?;
                Ok(Self {
                    child,
                    process_group,
                })
            }
            #[cfg(not(unix))]
            Ok(Self { child })
        }
    }

    pub async fn wait_or_terminate(&mut self, grace: Duration) {
        if matches!(
            tokio::time::timeout(grace, self.child.wait()).await,
            Ok(Ok(_))
        ) {
            return;
        }
        #[cfg(unix)]
        {
            self.signal_process_group(libc::SIGTERM);
            if matches!(
                tokio::time::timeout(Duration::from_millis(500), self.child.wait()).await,
                Ok(Ok(_))
            ) {
                return;
            }
        }
        self.terminate_now();
        let _ = self.child.wait().await;
    }

    pub fn terminate_now(&mut self) {
        #[cfg(windows)]
        self.job.terminate();
        #[cfg(unix)]
        self.signal_process_group(libc::SIGKILL);
        let _ = self.child.start_kill();
    }

    #[cfg(unix)]
    fn signal_process_group(&self, signal: i32) {
        // SAFETY: process_group is the positive pid of a child started as its own group leader.
        unsafe {
            let _ = libc::kill(-self.process_group, signal);
        }
    }
}

impl Drop for ManagedChild {
    fn drop(&mut self) {
        self.terminate_now();
    }
}

/// A short-lived protected child (Git, Python checks) that runs in its own
/// process group / job so it can be killed together with its descendants.
pub struct ProtectedStdChild {
    child: Option<std::process::Child>,
    #[cfg(windows)]
    job: WindowsJob,
    #[cfg(unix)]
    process_group: i32,
}

impl ProtectedStdChild {
    fn attach(child: std::process::Child) -> Result<Self, String> {
        #[cfg(windows)]
        {
            let process_id = child.id();
            let job = WindowsJob::attach(process_id)?;
            Ok(Self {
                child: Some(child),
                job,
            })
        }
        #[cfg(unix)]
        {
            let process_group = i32::try_from(child.id())
                .map_err(|_| "Spawned process id is out of range".to_string())?;
            Ok(Self {
                child: Some(child),
                process_group,
            })
        }
        #[cfg(not(any(windows, unix)))]
        Ok(Self { child: Some(child) })
    }

    pub fn wait(mut self) -> Result<std::process::Output, String> {
        let child = self
            .child
            .take()
            .ok_or_else(|| "Child process already finished".to_string())?;
        child
            .wait_with_output()
            .map_err(|error| format!("Failed to wait for child process: {error}"))
    }

    pub fn wait_timeout(mut self, timeout: Duration) -> Result<std::process::Output, String> {
        let Some(child) = self.child.take() else {
            return Err("Child process already finished".to_string());
        };
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(child.wait_with_output());
        });
        match receiver.recv_timeout(timeout) {
            Ok(Ok(output)) => Ok(output),
            Ok(Err(error)) => Err(format!("Failed to wait for child process: {error}")),
            Err(_) => {
                self.terminate_now();
                Err(format!(
                    "Command timed out after {timeout:?} and was terminated"
                ))
            }
        }
    }

    fn terminate_now(&mut self) {
        #[cfg(windows)]
        self.job.terminate();
        #[cfg(unix)]
        {
            // SAFETY: process_group is the positive pid of the child's own group leader.
            unsafe {
                let _ = libc::kill(-self.process_group, libc::SIGKILL);
            }
        }
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
        }
    }
}

impl Drop for ProtectedStdChild {
    fn drop(&mut self) {
        if self.child.is_some() {
            self.terminate_now();
            if let Some(mut child) = self.child.take() {
                let _ = child.wait();
            }
        }
    }
}

fn spawn_protected(
    program: &str,
    args: &[&str],
    current_dir: Option<&Path>,
) -> Result<ProtectedStdChild, String> {
    let mut command = create_command(program);
    command.args(args);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(directory) = current_dir {
        command.current_dir(directory);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let child = command
        .spawn()
        .map_err(|error| format!("Unable to start `{program}`: {error}"))?;
    ProtectedStdChild::attach(child)
}

/// Runs a short-lived command in its own process group / job and waits for it.
pub fn capture(
    program: &str,
    args: &[&str],
    current_dir: Option<&Path>,
) -> Result<std::process::Output, String> {
    spawn_protected(program, args, current_dir)?.wait()
}

/// Runs a short-lived command with a bounded wait; the whole process group is
/// terminated when the timeout elapses.
pub fn capture_with_timeout(
    program: &str,
    args: &[&str],
    current_dir: Option<&Path>,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    spawn_protected(program, args, current_dir)?.wait_timeout(timeout)
}

#[cfg(windows)]
struct WindowsJob {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for WindowsJob {}

#[cfg(windows)]
impl WindowsJob {
    fn attach(process_id: u32) -> Result<Self, String> {
        use std::ffi::c_void;
        use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };

        // SAFETY: all handles are checked before use and closed on every failure path.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(format!(
                    "Failed to create Windows job object: {}",
                    std::io::Error::last_os_error()
                ));
            }

            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const c_void,
                std::mem::size_of_val(&limits) as u32,
            ) == FALSE
            {
                let error = std::io::Error::last_os_error();
                CloseHandle(job);
                return Err(format!("Failed to configure Windows job object: {error}"));
            }

            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, FALSE, process_id);
            if process.is_null() {
                let error = std::io::Error::last_os_error();
                CloseHandle(job);
                return Err(format!("Failed to open child process: {error}"));
            }
            let assigned = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if assigned == FALSE {
                let error = std::io::Error::last_os_error();
                CloseHandle(job);
                return Err(format!("Failed to assign child process tree: {error}"));
            }
            Ok(Self { handle: job })
        }
    }

    fn terminate(&mut self) {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        // SAFETY: handle remains owned by this object until Drop closes it.
        unsafe {
            let _ = TerminateJobObject(self.handle, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        // SAFETY: this is the unique owned job handle.
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{capture, capture_with_timeout, ManagedChild};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn capture_returns_output_for_a_fast_command() {
        let output = capture("git", &["--version"], None).expect("git should run");
        assert!(output.status.success());
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(combined.contains("git version"));
    }

    #[test]
    fn capture_timeout_terminates_a_hanging_command() {
        #[cfg(windows)]
        let error = capture_with_timeout(
            "cmd",
            &["/c", "ping", "-n", "30", "127.0.0.1"],
            None,
            Duration::from_millis(300),
        )
        .expect_err("hanging command should time out");
        #[cfg(unix)]
        let error = capture_with_timeout(
            "/bin/sh",
            &["-c", "sleep 30"],
            None,
            Duration::from_millis(300),
        )
        .expect_err("hanging command should time out");
        assert!(error.contains("timed out"));
    }

    #[cfg(all(test, windows))]
    #[tokio::test]
    async fn terminating_the_job_stops_the_wrapper_and_node_descendant() {
        use tokio::process::Command;
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should follow the Unix epoch")
            .as_nanos();
        let pid_file = std::env::temp_dir().join(format!(
            "aurona-process-tree-{}-{unique}.pid",
            std::process::id()
        ));
        let script = "const{spawn}=require('child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync(process.env.AURONA_PROCESS_TREE_PID,String(p.pid));setInterval(()=>{},1000)";
        let mut command = Command::new("node");
        command
            .args(["-e", script])
            .env("AURONA_PROCESS_TREE_PID", &pid_file);

        let child = command.spawn().expect("Node wrapper should start");
        let mut managed = ManagedChild::attach(child).expect("process should join the job");

        let node_pid = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(raw_pid) = tokio::fs::read_to_string(&pid_file).await {
                    if let Ok(process_id) = raw_pid.trim().parse::<u32>() {
                        break process_id;
                    }
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("Node descendant should report its process id");

        managed.terminate_now();
        managed.wait_or_terminate(Duration::from_secs(1)).await;
        assert!(
            process_has_exited(node_pid),
            "Node descendant {node_pid} survived termination of its Windows job"
        );
        let _ = tokio::fs::remove_file(pid_file).await;
    }

    #[cfg(windows)]
    fn process_has_exited(process_id: u32) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, FALSE, WAIT_OBJECT_0};
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

        const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

        // SAFETY: the queried handle is checked and closed before returning.
        unsafe {
            let process = OpenProcess(SYNCHRONIZE_ACCESS, FALSE, process_id);
            if process.is_null() {
                return true;
            }
            let result = WaitForSingleObject(process, 2_000);
            CloseHandle(process);
            result == WAIT_OBJECT_0
        }
    }

    #[cfg(all(test, unix))]
    #[tokio::test]
    async fn terminating_the_group_stops_shell_descendants() {
        use tokio::process::Command;
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should follow the Unix epoch")
            .as_nanos();
        let pid_file = std::env::temp_dir().join(format!(
            "aurona-process-group-{}-{unique}.pid",
            std::process::id()
        ));
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg(format!(
            "sleep 30 & echo $! > '{}' && wait",
            pid_file.display()
        ));
        ManagedChild::configure(&mut command);
        let child = command.spawn().expect("shell should start");
        let mut managed = ManagedChild::attach(child).expect("process group should attach");

        let descendant = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(raw_pid) = tokio::fs::read_to_string(&pid_file).await {
                    if let Ok(process_id) = raw_pid.trim().parse::<i32>() {
                        break process_id;
                    }
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("descendant should report its process id");

        managed.terminate_now();
        managed.wait_or_terminate(Duration::from_secs(1)).await;
        let descendant_exited = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if !process_exists(descendant) {
                    break true;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap_or(false);
        assert!(
            descendant_exited,
            "descendant {descendant} survived process-group termination"
        );
        let _ = tokio::fs::remove_file(pid_file).await;
    }

    #[cfg(unix)]
    fn process_exists(process_id: i32) -> bool {
        // SAFETY: signal 0 only queries whether the process can be addressed.
        unsafe { libc::kill(process_id, 0) == 0 }
    }
}
