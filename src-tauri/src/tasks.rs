use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

#[derive(Default)]
struct Cancellation {
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    notify: Notify,
}

#[derive(Default)]
pub struct TaskState {
    active: Mutex<HashMap<String, Arc<Cancellation>>>,
    early_cancel: Mutex<HashMap<String, std::time::Instant>>,
}

pub struct TaskGuard<'a> {
    id: String,
    owner: &'a TaskState,
    cancellation: Arc<Cancellation>,
}

impl TaskState {
    pub fn begin(&self, id: &str) -> Result<TaskGuard<'_>, String> {
        if id.is_empty() || id.len() > 128 {
            return Err("[task.id] Invalid task ID".into());
        }
        let mut active = self
            .active
            .lock()
            .map_err(|_| "[task.state] Task registry unavailable")?;
        if active.len() >= 8 || active.contains_key(id) {
            return Err("[task.limit] Task ID already active or registry full".into());
        }
        let cancellation = Arc::new(Cancellation::default());
        let mut early = self
            .early_cancel
            .lock()
            .map_err(|_| "[task.state] Task registry unavailable")?;
        early.retain(|_, time| time.elapsed() < std::time::Duration::from_secs(60));
        if early.remove(id).is_some() {
            cancellation
                .cancelled
                .store(true, std::sync::atomic::Ordering::Release);
        }
        active.insert(id.into(), cancellation.clone());
        Ok(TaskGuard {
            id: id.into(),
            owner: self,
            cancellation,
        })
    }

    fn cancel(&self, id: &str) {
        if id.is_empty() || id.len() > 128 {
            return;
        }
        if let Ok(active) = self.active.lock() {
            if let Some(task) = active.get(id) {
                task.cancelled
                    .store(true, std::sync::atomic::Ordering::Release);
                task.notify.notify_waiters();
            } else if let Ok(mut early) = self.early_cancel.lock() {
                early.retain(|_, time| time.elapsed() < std::time::Duration::from_secs(60));
                if early.len() < 64 {
                    early.insert(id.into(), std::time::Instant::now());
                }
            }
        }
    }
}

impl TaskGuard<'_> {
    pub fn flag(&self) -> Arc<std::sync::atomic::AtomicBool> {
        self.cancellation.cancelled.clone()
    }
    pub async fn cancelled(&self) {
        loop {
            let notified = self.cancellation.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self
                .cancellation
                .cancelled
                .load(std::sync::atomic::Ordering::Acquire)
            {
                return;
            }
            notified.await;
        }
    }
}

impl Drop for TaskGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.owner.active.lock() {
            active.remove(&self.id);
        }
    }
}

#[tauri::command]
pub fn task_cancel(state: tauri::State<TaskState>, task_id: String) {
    state.cancel(&task_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancellation_before_registration_is_consumed_once_and_bounded() {
        let state = TaskState::default();
        state.cancel("early");
        let guard = state.begin("early").unwrap();
        tokio::time::timeout(std::time::Duration::from_millis(100), guard.cancelled())
            .await
            .unwrap();
        drop(guard);
        let next = state.begin("early").unwrap();
        assert!(!next
            .cancellation
            .cancelled
            .load(std::sync::atomic::Ordering::Acquire));
        for index in 0..1000 {
            state.cancel(&format!("unknown-{index}"));
        }
        assert!(state.early_cancel.lock().unwrap().len() <= 64);
    }
    #[tokio::test]
    async fn cancellation_is_sticky_and_all_terminal_paths_release_the_id() {
        let state = TaskState::default();
        let guard = state.begin("download").unwrap();
        assert!(state.begin("download").is_err());
        state.cancel("download");
        tokio::time::timeout(std::time::Duration::from_millis(100), guard.cancelled())
            .await
            .unwrap();
        drop(guard);
        assert!(state.active.lock().unwrap().is_empty());
        assert!(state.begin("download").is_ok());
    }
}
