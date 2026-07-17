use std::time::Duration;
use tokio::process::Child;

pub struct ManagedChild {
    child: Child,
    #[cfg(windows)]
    job: WindowsJob,
}

impl ManagedChild {
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
        self.terminate_now();
        let _ = self.child.wait().await;
    }

    pub fn terminate_now(&mut self) {
        #[cfg(windows)]
        self.job.terminate();
        let _ = self.child.start_kill();
    }
}

impl Drop for ManagedChild {
    fn drop(&mut self) {
        self.terminate_now();
    }
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
                return Err(format!("Failed to open LSP process: {error}"));
            }
            let assigned = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if assigned == FALSE {
                let error = std::io::Error::last_os_error();
                CloseHandle(job);
                return Err(format!("Failed to assign LSP process tree: {error}"));
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

#[cfg(all(test, windows))]
mod tests {
    use super::ManagedChild;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tokio::process::Command;

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

    #[tokio::test]
    async fn terminating_the_job_stops_the_wrapper_and_node_descendant() {
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
}
