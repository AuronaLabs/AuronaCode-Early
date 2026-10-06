use std::io::{Read, Write};
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
type OutputWorker = std::thread::JoinHandle<Result<(Vec<u8>, bool), String>>;
pub struct ProtectedStdChild {
    child: Option<std::process::Child>,
    stdout: Option<OutputWorker>,
    stderr: Option<OutputWorker>,
    input: Option<std::thread::JoinHandle<Result<(), String>>>,
    #[cfg(windows)]
    job: WindowsJob,
    #[cfg(unix)]
    process_group: i32,
}

impl ProtectedStdChild {
    fn attach(child: std::process::Child) -> Result<Self, String> {
        Self::attach_stdout(child, drain_output)
    }

    fn attach_stdout(
        mut child: std::process::Child,
        consume: impl FnOnce(std::process::ChildStdout) -> Result<(Vec<u8>, bool), String>
            + Send
            + 'static,
    ) -> Result<Self, String> {
        let stdout = child.stdout.take().ok_or("Child stdout is unavailable")?;
        let stderr = child.stderr.take().ok_or("Child stderr is unavailable")?;
        #[cfg(windows)]
        {
            let process_id = child.id();
            let job = match WindowsJob::attach(process_id) {
                Ok(job) => job,
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            };
            Ok(Self {
                child: Some(child),
                stdout: Some(std::thread::spawn(move || consume(stdout))),
                stderr: Some(std::thread::spawn(move || drain_output(stderr))),
                input: None,
                job,
            })
        }
        #[cfg(unix)]
        {
            let process_group = i32::try_from(child.id())
                .map_err(|_| "Spawned process id is out of range".to_string())?;
            Ok(Self {
                child: Some(child),
                stdout: Some(std::thread::spawn(move || consume(stdout))),
                stderr: Some(std::thread::spawn(move || drain_output(stderr))),
                input: None,
                process_group,
            })
        }
        #[cfg(not(any(windows, unix)))]
        Ok(Self {
            child: Some(child),
            stdout: Some(std::thread::spawn(move || consume(stdout))),
            stderr: Some(std::thread::spawn(move || drain_output(stderr))),
            input: None,
        })
    }

    #[cfg(test)]
    pub fn wait(self) -> Result<std::process::Output, String> {
        self.wait_timeout(Duration::from_secs(60))
    }

    fn write_input(&mut self, input: &[u8]) -> Result<(), String> {
        let stdin = self
            .child
            .as_mut()
            .and_then(|child| child.stdin.take())
            .ok_or_else(|| "Child process stdin is unavailable".to_string())?;
        let input = input.to_owned();
        self.input = Some(std::thread::spawn(move || {
            let mut stdin = stdin;
            stdin
                .write_all(&input)
                .map_err(|_| "Failed to write process input".to_string())
        }));
        Ok(())
    }

    pub fn wait_timeout(self, timeout: Duration) -> Result<std::process::Output, String> {
        self.wait_until(timeout, || false)
    }

    pub fn wait_until(
        mut self,
        timeout: Duration,
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<std::process::Output, String> {
        let deadline = std::time::Instant::now() + timeout;
        let mut was_cancelled = false;
        let status = loop {
            if cancelled() {
                was_cancelled = true;
                self.terminate_now();
                let _ = self.child.as_mut().and_then(|child| child.wait().ok());
                break None;
            }
            if let Some(status) = self
                .child
                .as_mut()
                .ok_or("Child process already finished")?
                .try_wait()
                .map_err(|error| error.to_string())?
            {
                break Some(status);
            }
            if std::time::Instant::now() >= deadline {
                self.terminate_now();
                let _ = self.child.as_mut().and_then(|child| child.wait().ok());
                break None;
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        // Descendants may retain inherited pipes after the primary process exits.
        self.terminate_now();
        self.child.take();
        let stdout = join_output(self.stdout.take())?;
        let stderr = join_output(self.stderr.take())?;
        if let Some(input) = self.input.take() {
            let result = input.join().map_err(|_| "Process input worker failed")?;
            if status.is_some() {
                result?;
            }
        }
        if was_cancelled {
            return Err("[process.cancelled] Command cancelled and process tree terminated".into());
        }
        let status = status
            .ok_or_else(|| format!("Command timed out after {timeout:?} and was terminated"))?;
        if stdout.1 || stderr.1 {
            return Err("[process.output_limit] Output exceeded the 4 MiB retention limit; output was drained and truncated".into());
        }
        Ok(std::process::Output {
            status,
            stdout: stdout.0,
            stderr: stderr.0,
        })
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

fn drain_output(mut reader: impl Read) -> Result<(Vec<u8>, bool), String> {
    let mut retained = Vec::new();
    let mut buffer = [0u8; 16 * 1024];
    let mut truncated = false;
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error.to_string()),
        };
        let keep =
            count.min(crate::resource_limits::PROCESS_OUTPUT_BYTES.saturating_sub(retained.len()));
        retained.extend_from_slice(&buffer[..keep]);
        truncated |= keep < count;
    }
    Ok((retained, truncated))
}

fn join_output(worker: Option<OutputWorker>) -> Result<(Vec<u8>, bool), String> {
    worker
        .ok_or("Process output worker is unavailable")?
        .join()
        .map_err(|_| "Process output worker failed")?
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

pub(crate) fn spawn_protected(
    program: &str,
    args: &[&str],
    current_dir: Option<&Path>,
    stdin_piped: bool,
) -> Result<ProtectedStdChild, String> {
    ProtectedStdChild::attach(spawn_piped(program, args, current_dir, stdin_piped)?)
}

fn spawn_piped(
    program: &str,
    args: &[&str],
    current_dir: Option<&Path>,
    stdin_piped: bool,
) -> Result<std::process::Child, String> {
    let mut command = create_command(program);
    command.args(args);
    command
        .stdin(if stdin_piped {
            Stdio::piped()
        } else {
            Stdio::null()
        })
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
    command
        .spawn()
        .map_err(|error| format!("Unable to start `{program}`: {error}"))
}

pub(crate) fn capture_to_file(
    program: &str,
    args: &[&str],
    current_dir: &Path,
    mut target: cap_std::fs::File,
    expected_bytes: usize,
    cancelled: impl FnMut() -> bool,
) -> Result<std::process::Output, String> {
    if expected_bytes > crate::resource_limits::TEXT_BYTES {
        return Err("[resource.limit] Streamed file exceeds 32 MiB".into());
    }
    let child = spawn_piped(program, args, Some(current_dir), false)?;
    ProtectedStdChild::attach_stdout(child, move |mut stdout| {
        let mut bytes = 0usize;
        let mut buffer = [0u8; crate::resource_limits::FILE_CHUNK_BYTES];
        loop {
            let count = stdout.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            bytes = bytes
                .checked_add(count)
                .ok_or("[resource.limit] Stream length overflow")?;
            if bytes > expected_bytes {
                return Err("[git.recovery] Recovery blob grew beyond its verified size".into());
            }
            target
                .write_all(&buffer[..count])
                .map_err(|e| e.to_string())?;
        }
        if bytes != expected_bytes {
            return Err("[git.recovery] Recovery blob length mismatch".into());
        }
        target.sync_all().map_err(|e| e.to_string())?;
        Ok((Vec::new(), false))
    })?
    .wait_until(Duration::from_secs(60), cancelled)
}

/// Runs a short-lived command in its own process group / job and waits for it.
#[cfg(test)]
pub fn capture(
    program: &str,
    args: &[&str],
    current_dir: Option<&Path>,
) -> Result<std::process::Output, String> {
    spawn_protected(program, args, current_dir, false)?.wait()
}

/// Runs a short-lived protected command with input supplied through stdin.
pub fn capture_with_input(
    program: &str,
    args: &[&str],
    current_dir: Option<&Path>,
    input: &[u8],
    timeout: Duration,
    cancelled: impl FnMut() -> bool,
) -> Result<std::process::Output, String> {
    let mut child = spawn_protected(program, args, current_dir, true)?;
    child.write_input(input)?;
    child.wait_until(timeout, cancelled)
}

/// Runs a short-lived command with a bounded wait; the whole process group is
/// terminated when the timeout elapses.
pub fn capture_with_timeout(
    program: &str,
    args: &[&str],
    current_dir: Option<&Path>,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    spawn_protected(program, args, current_dir, false)?.wait_timeout(timeout)
}

#[cfg(windows)]
pub(crate) struct WindowsJob {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for WindowsJob {}

#[cfg(windows)]
impl WindowsJob {
    pub(crate) fn attach(process_id: u32) -> Result<Self, String> {
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

    pub(crate) fn terminate(&mut self) {
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
    #[test]
    fn cancellation_reclaims_a_running_process_tree_within_two_seconds() {
        let started = std::time::Instant::now();
        let process = super::spawn_protected("node", &["-e", "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setInterval(()=>{},1000)"], None, false).unwrap();
        let error = process
            .wait_until(Duration::from_secs(30), || {
                started.elapsed() > Duration::from_millis(200)
            })
            .unwrap_err();
        assert!(error.contains("process.cancelled"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
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
    fn stdout_and_stderr_are_drained_concurrently_after_the_retention_limit() {
        let error = capture_with_timeout("node", &["-e", "const b=Buffer.alloc(65536,120);for(let i=0;i<96;i++){require('fs').writeSync(1,b);require('fs').writeSync(2,b)}"], None, Duration::from_secs(30)).expect_err("output must be bounded");
        assert!(error.contains("output_limit"), "{error}");
    }

    #[test]
    fn output_drainer_consumes_all_input_without_retaining_it() {
        let input = std::io::Cursor::new(vec![42u8; 5 * 1024 * 1024]);
        let (output, truncated) = super::drain_output(input).unwrap();
        assert_eq!(output.len(), crate::resource_limits::PROCESS_OUTPUT_BYTES);
        assert!(truncated);
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

        // CI 的 Windows runner 首次启动 node.exe 时会被 Defender 实时扫描拖慢（内层还会再
        // spawn 一个 node 子进程），5 秒远远不够。给到 30 秒的宽限；node 真缺失时
        // 上面的 spawn().expect() 会立刻失败，不会在这里空等。
        let node_pid = tokio::time::timeout(Duration::from_secs(30), async {
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
