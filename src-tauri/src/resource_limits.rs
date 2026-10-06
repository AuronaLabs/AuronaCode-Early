pub const TEXT_BYTES: usize = 32 * 1024 * 1024;
pub static DOWNLOADS: std::sync::LazyLock<tokio::sync::Semaphore> =
    std::sync::LazyLock::new(|| tokio::sync::Semaphore::new(2));
pub const FILE_CHUNK_BYTES: usize = 256 * 1024;
pub const DIRECTORY_PAGE_ENTRIES: usize = 256;
pub const WORKSPACE_WATCHERS: usize = 16;
pub const WATCH_PATHS: usize = 4096;
pub const DOWNLOAD_BYTES: u64 = 1024 * 1024 * 1024;
pub const ARCHIVE_ENTRIES: usize = 100_000;
pub const EXPANDED_BYTES: u64 = 8 * 1024 * 1024 * 1024;
pub const EXPANDED_ENTRY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const COMPRESSION_RATIO: u64 = 200;
pub const AI_REQUEST_BYTES: usize = 4 * 1024 * 1024;
pub const AI_EVENT_BYTES: usize = 1024 * 1024;
pub const AI_OUTPUT_BYTES: usize = 32 * 1024 * 1024;
pub const AI_REQUESTS: usize = 4;
pub const AI_TOOLS: usize = 64;
pub const PENDING_REQUESTS: usize = 128;
pub const LSP_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;
pub const LSP_CHANGE_BYTES: usize = 1024 * 1024;
pub const PROCESS_LOG_LINE_BYTES: usize = 16 * 1024;
pub const DAP_SESSIONS: usize = 4;
pub const PTY_SESSIONS: usize = 8;
pub const PTY_INPUT_BYTES: usize = 64 * 1024;
pub const PROCESS_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
pub const EXTENSION_PAYLOAD_BYTES: usize = 256 * 1024;
pub const EXTENSION_PENDING: usize = 64;
pub const EXTENSION_EVENTS: usize = 256;
pub const GLOBAL_WATCHERS: usize = 64;
pub const EXTENSION_WATCHERS: usize = 4;
pub const WATCH_BATCH_BYTES: usize = 64 * 1024;

#[derive(Default)]
pub struct WatchBatch {
    paths: std::collections::HashSet<String>,
    bytes: usize,
    overflow: bool,
}

impl WatchBatch {
    pub fn push(&mut self, path: String) {
        if self.paths.contains(&path) {
            return;
        }
        // Count serialized bytes so escaping cannot exceed the payload budget.
        let bytes = serde_json::to_string(&path).map_or(usize::MAX, |text| text.len() + 1);
        if self.paths.len() >= WATCH_PATHS || bytes > WATCH_BATCH_BYTES.saturating_sub(self.bytes) {
            self.overflow = true;
            return;
        }
        self.bytes += bytes;
        self.paths.insert(path);
    }
    pub fn has_events(&self) -> bool {
        !self.paths.is_empty() || self.overflow
    }
    pub fn take(&mut self) -> (Vec<String>, bool) {
        self.bytes = 0;
        (
            self.paths.drain().collect(),
            std::mem::take(&mut self.overflow),
        )
    }
}

#[derive(Clone)]
struct WatchOwner {
    generation: u64,
    extension: Option<String>,
}
static WATCHERS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<u64, WatchOwner>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

pub struct WatchLease(u64);
impl Drop for WatchLease {
    fn drop(&mut self) {
        if let Ok(mut registry) = WATCHERS.lock() {
            registry.remove(&self.0);
        }
    }
}
pub fn acquire_watcher(generation: u64, extension: Option<&str>) -> Result<WatchLease, String> {
    let mut registry = WATCHERS
        .lock()
        .map_err(|_| "[watcher.state] Watcher registry unavailable")?;
    if registry.len() >= GLOBAL_WATCHERS
        || registry
            .values()
            .filter(|owner| owner.generation == generation)
            .count()
            >= WORKSPACE_WATCHERS
        || extension.is_some_and(|id| {
            registry
                .values()
                .filter(|owner| {
                    owner.generation == generation && owner.extension.as_deref() == Some(id)
                })
                .count()
                >= EXTENSION_WATCHERS
        })
    {
        return Err("[resource.limit] Shared watcher budget reached".into());
    }
    let id = loop {
        let id = rand::random::<u64>();
        if !registry.contains_key(&id) {
            break id;
        }
    };
    registry.insert(
        id,
        WatchOwner {
            generation,
            extension: extension.map(str::to_owned),
        },
    );
    Ok(WatchLease(id))
}

#[tauri::command]
pub fn resource_budgets() -> serde_json::Value {
    serde_json::json!({
        "textBytes": TEXT_BYTES, "chunkBytes": FILE_CHUNK_BYTES, "directoryPageEntries": DIRECTORY_PAGE_ENTRIES,
        "watchers": { "global": GLOBAL_WATCHERS, "workspace": WORKSPACE_WATCHERS, "extension": EXTENSION_WATCHERS, "pendingPaths": WATCH_PATHS },
        "download": { "concurrency": 2, "bytes": DOWNLOAD_BYTES, "expandedBytes": EXPANDED_BYTES, "entryBytes": EXPANDED_ENTRY_BYTES, "entries": ARCHIVE_ENTRIES, "compressionRatio": COMPRESSION_RATIO },
        "ai": { "requests": AI_REQUESTS, "requestBytes": AI_REQUEST_BYTES, "eventBytes": AI_EVENT_BYTES, "outputBytes": AI_OUTPUT_BYTES, "tools": AI_TOOLS },
        "protocol": { "pending": PENDING_REQUESTS, "documentBytes": LSP_DOCUMENT_BYTES, "changeBytes": LSP_CHANGE_BYTES, "dapSessions": DAP_SESSIONS, "logLineBytes": PROCESS_LOG_LINE_BYTES },
        "pty": { "sessions": PTY_SESSIONS, "inputBytes": PTY_INPUT_BYTES }, "processOutputBytes": PROCESS_OUTPUT_BYTES,
        "extension": { "payloadBytes": EXTENSION_PAYLOAD_BYTES, "pending": EXTENSION_PENDING, "events": EXTENSION_EVENTS },
        "historyBytes": 64 * 1024 * 1024, "checkpointBytes": 256 * 1024 * 1024, "hotViews": 12
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one_hundred_thousand_watch_events_are_bounded_deduplicated_and_mark_overflow() {
        let mut batch = WatchBatch::default();
        for _ in 0..100_000 {
            batch.push("repeated".into());
        }
        assert_eq!(batch.paths.len(), 1);
        for i in 0..100_000 {
            batch.push(format!("entry-{i}"));
        }
        assert!(batch.paths.len() <= WATCH_PATHS);
        assert!(batch.bytes <= WATCH_BATCH_BYTES);
        let (paths, overflow) = batch.take();
        assert!(overflow);
        assert!(serde_json::to_vec(&paths).unwrap().len() <= WATCH_BATCH_BYTES + 2);
        assert!(!batch.has_events());
        batch.push("\"".repeat(WATCH_BATCH_BYTES));
        assert!(batch.take().1);
    }
    #[test]
    fn shared_watcher_budget_is_released_across_one_hundred_cycles() {
        for generation in 10000..10100 {
            let leases = (0..4)
                .map(|_| acquire_watcher(generation, Some("fixture")).unwrap())
                .collect::<Vec<_>>();
            assert!(acquire_watcher(generation, Some("fixture")).is_err());
            let workspace = (0..12)
                .map(|_| acquire_watcher(generation, None).unwrap())
                .collect::<Vec<_>>();
            assert!(acquire_watcher(generation, None).is_err());
            drop(leases);
            drop(workspace);
            assert!(WATCHERS
                .lock()
                .unwrap()
                .values()
                .all(|owner| owner.generation != generation));
        }
    }
}
