//! Runtime leases, bounded event queues and watcher cleanup.
use super::*;

/// 扩展事件队列（SDK v1 增量）：前端把文档变更等事件推入，扩展经
/// `poll-events` 拉取（sync linker 无回调能力，拉取模型替代推送）。
pub(super) static HOST_EVENT_QUEUES: LazyLock<Mutex<HashMap<String, Vec<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
pub(super) static RUNTIME_LEASES: LazyLock<
    Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn runtime_lease(id: &str) -> Result<Arc<std::sync::atomic::AtomicBool>, String> {
    let mut entries = RUNTIME_LEASES
        .lock()
        .map_err(|_| "[extension.lifecycle] Registry unavailable")?;
    if !entries.contains_key(id) && entries.len() >= 64 {
        return Err("[resource.limit] Active extension limit reached".into());
    }
    Ok(entries
        .entry(id.to_string())
        .or_insert_with(|| Arc::new(std::sync::atomic::AtomicBool::new(true)))
        .clone())
}
pub(super) const MAX_EVENT_QUEUE: usize = crate::resource_limits::EXTENSION_EVENTS;

/// 前端推送一条扩展事件（commands.rs `extensions_push_event` 调用）。
pub(super) fn push_host_event(
    extension_id: &str,
    lease: &Option<Arc<std::sync::atomic::AtomicBool>>,
    event: String,
) -> Result<(), String> {
    let leases = RUNTIME_LEASES
        .lock()
        .map_err(|_| "[extension.lifecycle] Registry unavailable")?;
    if !lease.as_ref().is_some_and(|lease| {
        lease.load(std::sync::atomic::Ordering::Acquire)
            && leases
                .get(extension_id)
                .is_some_and(|owner| Arc::ptr_eq(owner, lease))
    }) {
        return Err("[extension.generation] Event owner expired".into());
    }
    if event.len() > crate::resource_limits::EXTENSION_PAYLOAD_BYTES {
        return Err("[resource.limit] Extension event exceeds limit".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(&event).map_err(|_| "[extension.event] Invalid event JSON")?;
    if !matches!(
        value.get("type").and_then(serde_json::Value::as_str),
        Some("workspace-changed" | "document-changed")
    ) {
        return Err("[extension.event] Undeclared event kind".into());
    }
    let mut guard = HOST_EVENT_QUEUES
        .lock()
        .map_err(|_| "[extension.event] Queue unavailable")?;
    if !guard.contains_key(extension_id) && guard.len() >= 64 {
        return Err("[resource.limit] Extension event owner limit reached".into());
    }
    let queue = guard.entry(extension_id.to_string()).or_default();
    if queue.len() >= MAX_EVENT_QUEUE {
        return Err("[extension.overflow] Event queue is full; resynchronization required".into());
    }
    queue.push(event);
    Ok(())
}

/// 取走该扩展的全部挂起事件。
pub(super) fn drain_host_events(extension_id: &str) -> Vec<String> {
    HOST_EVENT_QUEUES
        .lock()
        .ok()
        .and_then(|mut guard| guard.remove(extension_id))
        .unwrap_or_default()
}

/// 扩展文件监视注册表（SDK v1）：watch_id → 监视项。
/// watcher 被 drop 即停止监听，事件线程随 channel 断开自动退出；
/// 扩展应显式 unwatch，应用退出时随进程统一丢弃。
pub(super) struct ExtensionWatchEntry {
    pub(super) extension_id: String,
    pub(super) _watcher: notify::RecommendedWatcher,
    pub(super) _lease: crate::resource_limits::WatchLease,
}

pub(super) static WATCH_REGISTRY: LazyLock<Mutex<HashMap<u64, ExtensionWatchEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
pub(super) static WATCH_COUNTER: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(1);

/// 供 commands.rs 调用的桥应答入口（`extensions_host_response`）。
pub fn host_bridge_respond(
    request_id: &str,
    extension_id: &str,
    kind: &str,
    generation: u64,
    value: String,
) -> bool {
    host_bridge::respond(request_id, extension_id, kind, generation, value)
}

pub fn cleanup_extension_resources(extension_id: Option<&str>) {
    host_bridge::cleanup(extension_id);
    if let Ok(mut guard) = WATCH_REGISTRY.lock() {
        guard.retain(|_, watch| extension_id.is_some_and(|id| watch.extension_id != id));
    }
    if let Ok(mut leases) = RUNTIME_LEASES.lock() {
        leases.retain(|id, lease| {
            if extension_id.is_none_or(|removed| id == removed) {
                lease.store(false, std::sync::atomic::Ordering::Release);
                false
            } else {
                true
            }
        });
    }
    if let Ok(mut guard) = HOST_EVENT_QUEUES.lock() {
        guard.retain(|id, _| extension_id.is_some_and(|removed| id != removed));
    }
}
