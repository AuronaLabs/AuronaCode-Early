//! Component execution and host context; capabilities and resources are separate modules.
mod host;
mod limits;
mod resources;
pub use limits::ExtensionLimits;
use resources::*;
pub use resources::{cleanup_extension_resources, host_bridge_respond, runtime_lease};

use std::collections::HashMap;
use std::path::{Component, Path};
use std::sync::Arc;
use std::sync::{LazyLock, Mutex};

use tauri::Emitter;
use wasmtime::component::wit_parser::ItemName;
use wasmtime::component::{bindgen, HasSelf, Instance, Linker, ResourceTable, TypedFunc};
use wasmtime::{Config, Engine, Store, StoreLimits, StoreLimitsBuilder};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

bindgen!({
    world: "aurona-extension",
    path: "../Extensions/wit/world.wit",
});

pub use aurona::extensions::context::{
    EditorSnapshot as ContextEditorSnapshot, Environment as ContextEnvironment,
    FileEntry as ContextFileEntry, GitFileStatus as ContextGitFileStatus,
    GitLogEntry as ContextGitLogEntry, GitRepoInfo as ContextGitRepoInfo,
    PermissionState as ContextPermissionState, SelectionRange as ContextSelectionRange,
    WorkspaceInfo as ContextWorkspaceInfo,
};
pub use exports::aurona::extensions::render::{RenderInput, RenderOutput};

// 沙箱限额（规划 §5.3.1）：JS 兼容运行时（boa）作为 guest 组件启动与执行的
// 指令量远大于纯 Rust 组件，64MB/10M fuel 连 QuickJS/boa 启动都不够，
// 因此统一放宽：内存 256MB 起、执行燃料提到 40 亿，实例化单独 500M。
const DEFAULT_MEMORY_BYTES: usize = 64 * 1024 * 1024;
const DEFAULT_FUEL: u64 = 100_000_000;
const INSTANTIATE_FUEL: u64 = 500_000_000;
const MAX_WORKSPACE_READ_BYTES: u64 = 4 * 1024 * 1024;
const MAX_WORKSPACE_RANGE_BYTES: u64 = 256 * 1024;
const MAX_WORKSPACE_WRITE_BYTES: usize = 10 * 1024 * 1024;
const MAX_WORKSPACE_LIST_ENTRIES: u32 = 1000;
const MAX_FLIUNO_ITEMS: usize = 50;
const MAX_GIT_LOG_ENTRIES: usize = 100;

fn validate_storage_dir(storage_dir: &Path) -> Result<(), String> {
    if !storage_dir.exists() {
        return Ok(());
    }
    let metadata = std::fs::symlink_metadata(storage_dir).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Extension storage directory is not a regular directory".to_string());
    }
    let parent = storage_dir
        .parent()
        .ok_or_else(|| "Invalid extension storage directory".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let canonical = storage_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if canonical.parent() != Some(parent.as_path()) {
        return Err("Extension storage directory escaped its parent".to_string());
    }
    Ok(())
}

fn ensure_workspace_write_location(root: &Path, existing: &Path) -> Result<(), String> {
    let canonical = existing.canonicalize().map_err(|error| error.to_string())?;
    let relative = canonical
        .strip_prefix(root)
        .map_err(|_| "Workspace write path escaped the workspace".to_string())?;
    if relative.components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
    }) {
        return Err("Workspace write path resolves into .git".to_string());
    }
    Ok(())
}

fn resolve_storage_file(storage_dir: &Path, key: &str) -> Result<std::path::PathBuf, String> {
    if key.is_empty()
        || key.len() > 128
        || key == "."
        || key == ".."
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err("Invalid extension storage key".to_string());
    }
    validate_storage_dir(storage_dir)?;
    let path = storage_dir.join(format!("{key}.json"));
    if let Ok(metadata) = std::fs::symlink_metadata(&path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Extension storage entry is not a regular file".to_string());
        }
        let canonical = path.canonicalize().map_err(|error| error.to_string())?;
        let parent = storage_dir
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if canonical.parent() != Some(parent.as_path()) {
            return Err("Extension storage entry escaped its directory".to_string());
        }
    }
    Ok(path)
}

/// Fliuno 贡献项的宿主侧载荷（bindgen 类型未实现 Serialize，事件里用它）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct FliunoContributedItem {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub action: String,
}

/// 宿主↔前端请求-响应桥（SDK v1 增量，0.4.6）。
///
/// host 函数（对话框 / 剪贴板 / 命令执行）需要用户交互或前端能力，而 WASM
/// 调用运行在 `spawn_blocking` 线程：向 UI 发 `extension://host-request` 事件后
/// 阻塞等待 `extensions_host_response` 回填应答是安全的。超时保护防止 UI
/// 无响应时拖死调用线程（wasm 侧收到明确错误，不会永久等待）。
mod host_bridge {
    use std::collections::HashMap;
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant};

    struct PendingRequest {
        sender: Sender<String>,
        kind: &'static str,
        extension_id: String,
        generation: u64,
        deadline: Instant,
    }

    static PENDING: LazyLock<Mutex<HashMap<String, PendingRequest>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    pub fn next_request_id() -> String {
        format!("host-req-{:032x}", rand::random::<u128>())
    }

    /// 注册请求并返回应答接收端；前端经 `extensions_host_response` 回填。
    pub fn register(
        request_id: &str,
        kind: &'static str,
        extension_id: &str,
        generation: u64,
        timeout: Duration,
    ) -> Result<Receiver<String>, String> {
        let (sender, receiver) = channel::<String>();
        let mut guard = PENDING
            .lock()
            .map_err(|_| "[host.registry] Request registry unavailable")?;
        guard.retain(|_, pending| pending.deadline > Instant::now());
        if guard.len() >= 512
            || guard
                .values()
                .filter(|pending| pending.extension_id == extension_id)
                .count()
                >= crate::resource_limits::EXTENSION_PENDING
        {
            return Err("[resource.limit] Extension pending request limit reached".into());
        }
        if guard.contains_key(request_id) {
            return Err("[host.duplicate] Duplicate request handle".into());
        }
        guard.insert(
            request_id.to_string(),
            PendingRequest {
                sender,
                kind,
                extension_id: extension_id.to_string(),
                generation,
                deadline: Instant::now() + timeout,
            },
        );
        Ok(receiver)
    }

    /// 前端回填应答；请求不存在（已超时清理）时返回 false。
    pub fn respond(
        request_id: &str,
        extension_id: &str,
        kind: &str,
        generation: u64,
        value: String,
    ) -> bool {
        if value.len() > crate::resource_limits::EXTENSION_PAYLOAD_BYTES
            || serde_json::from_str::<serde_json::Value>(&value).is_err()
        {
            return false;
        }
        let Ok(mut guard) = PENDING.lock() else {
            return false;
        };
        let Some(pending) = guard.get(request_id) else {
            return false;
        };
        if pending.deadline <= Instant::now() {
            guard.remove(request_id);
            return false;
        }
        if pending.extension_id != extension_id
            || pending.kind != kind
            || pending.generation != generation
        {
            return false;
        }
        guard
            .remove(request_id)
            .is_some_and(|pending| pending.sender.send(value).is_ok())
    }

    pub fn cancel(request_id: &str) {
        if let Ok(mut guard) = PENDING.lock() {
            guard.remove(request_id);
        }
    }
    pub fn cleanup(extension_id: Option<&str>) {
        if let Ok(mut guard) = PENDING.lock() {
            guard.retain(|_, pending| extension_id.is_some_and(|id| id != pending.extension_id));
        }
    }

    /// 阻塞等待前端应答；超时后清理挂起请求并返回错误。
    pub fn wait_response(
        request_id: &str,
        receiver: Receiver<String>,
        timeout: Duration,
    ) -> Result<String, String> {
        let result = match receiver.recv_timeout(timeout) {
            Ok(value) => Ok(value),
            Err(_) => {
                if let Ok(mut guard) = PENDING.lock() {
                    guard.remove(request_id);
                }
                Err("[host.timeout] 前端应答超时".to_string())
            }
        };
        cancel(request_id);
        result
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn response_cannot_consume_another_owner_kind_or_generation() {
            let id = next_request_id();
            let receiver =
                register(&id, "confirm", "test.bridge", 42, Duration::from_secs(1)).unwrap();
            for (owner, kind, generation) in [
                ("other", "confirm", 42),
                ("test.bridge", "input", 42),
                ("test.bridge", "confirm", 43),
            ] {
                assert!(!respond(&id, owner, kind, generation, "{}".into()));
            }
            assert!(respond(&id, "test.bridge", "confirm", 42, "{}".into()));
            assert!(!respond(&id, "test.bridge", "confirm", 42, "{}".into()));
            assert_eq!(
                wait_response(&id, receiver, Duration::from_secs(1)).unwrap(),
                "{}"
            );
        }
        #[test]
        fn expired_and_oversized_responses_fail() {
            let id = next_request_id();
            let _receiver = register(&id, "input", "test.expired", 1, Duration::ZERO).unwrap();
            assert!(!respond(&id, "test.expired", "input", 1, "{}".into()));
            let id = next_request_id();
            let _receiver =
                register(&id, "input", "test.expired", 1, Duration::from_secs(1)).unwrap();
            assert!(!respond(
                &id,
                "test.expired",
                "input",
                1,
                "x".repeat(crate::resource_limits::EXTENSION_PAYLOAD_BYTES + 1)
            ));
            cancel(&id);
        }
    }
}

/// Per-call context supplied to the WASM component. The host decides what the
/// extension may see; the component itself cannot reach beyond these values.
#[cfg(test)]
type TestFrontendEvents = Arc<Mutex<Vec<(String, serde_json::Value)>>>;

pub struct ExtensionContext {
    #[cfg(test)]
    test_frontend_events: Option<TestFrontendEvents>,
    pub workspace_generation: u64,
    pub runtime_lease: Option<Arc<std::sync::atomic::AtomicBool>>,
    pub extension_id: String,
    pub workspace_root: Option<std::path::PathBuf>,
    pub workspace_name: Option<String>,
    pub data_dir: Option<std::path::PathBuf>,
    pub environment: ContextEnvironment,
    pub editor_snapshot: Option<ContextEditorSnapshot>,
    pub editor_selection: Option<ContextSelectionRange>,
    /// 活动编辑器的选中文本。仅在 `editor.current.read` 已授权时由 host 填充。
    pub editor_selection_text: Option<String>,
    /// 宿主应用句柄：用于把编辑器写入 / Fliuno 贡献等"需要回传前端"的请求
    /// 以事件形式交给 UI 层。仅 host 函数内部使用，不暴露给组件。
    pub app: Option<tauri::AppHandle>,
    /// 该扩展在本工作区下的权限快照。由 host 依据权限目录（`permissions::PERMISSIONS`）
    /// 与持久化授权记录填充；组件侧的一切权限判断都必须经由 [`ExtensionContext::require`]。
    pub permissions: HashMap<String, ContextPermissionState>,
    pub limits: StoreLimits,
    pub wasi: WasiCtx,
    pub table: ResourceTable,
}

impl ExtensionContext {
    pub fn new(
        workspace_root: Option<std::path::PathBuf>,
        environment: ContextEnvironment,
    ) -> Self {
        Self {
            #[cfg(test)]
            test_frontend_events: None,
            workspace_generation: 0,
            runtime_lease: None,
            extension_id: "anonymous".to_string(),
            workspace_root,
            workspace_name: None,
            data_dir: None,
            environment,
            editor_snapshot: None,
            editor_selection: None,
            editor_selection_text: None,
            app: None,
            permissions: HashMap::new(),
            limits: ExtensionLimits::default().store_limits(),
            wasi: WasiCtxBuilder::new().build(),
            table: ResourceTable::new(),
        }
    }

    pub fn get_storage_dir(&self) -> std::path::PathBuf {
        if let Some(dir) = &self.data_dir {
            dir.join("extension-storage").join(&self.extension_id)
        } else {
            std::env::temp_dir()
                .join("aurona-extensions-storage")
                .join(&self.extension_id)
        }
    }

    /// 把宿主事件发给前端 UI 层（编辑器桥 / Fliuno 注册表）。
    fn emit_to_frontend(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        use tauri::Emitter;
        #[cfg(test)]
        if let Some(events) = &self.test_frontend_events {
            events.lock().unwrap().push((event.to_string(), payload));
            return Ok(());
        }
        let app = self
            .app
            .as_ref()
            .ok_or_else(|| "宿主应用句柄不可用".to_string())?;
        app.emit(event, payload)
            .map_err(|error| format!("发送宿主事件失败: {error}"))
    }

    fn ensure_git_read(&self) -> Result<(), String> {
        self.require_granted("git.read")
    }

    /// git 只读操作（info/status/log/diff）的公共前置：git.read + 工作区。
    fn git_workspace_root(&self) -> Result<std::path::PathBuf, String> {
        self.ensure_git_read()?;
        self.workspace_root
            .clone()
            .ok_or_else(|| "尚未打开工作区".to_string())
    }

    /// git 写操作（stage/unstage/commit）的公共前置：git.write + 工作区。
    fn git_write_root(&self) -> Result<std::path::PathBuf, String> {
        self.require_granted("git.write")?;
        self.workspace_root
            .clone()
            .ok_or_else(|| "尚未打开工作区".to_string())
    }

    /// 一切权限判断的唯一入口。
    ///
    /// - 未开放的权限（目录里 `available: false`）返回 `Err`，让扩展能区分
    ///   "被用户拒绝"与"当前版本没有这个能力"，而不是拿到一个含义模糊的 Denied。
    /// - 已开放但未授权返回 `Ok(Unknown)`。
    pub fn require(&self, permission: &str) -> Result<ContextPermissionState, String> {
        self.require_current()?;
        super::permissions::ensure_requestable(permission)?;
        Ok(self
            .permissions
            .get(permission)
            .copied()
            .unwrap_or(ContextPermissionState::Unknown))
    }

    fn require_current(&self) -> Result<(), String> {
        use tauri::Manager;
        if self
            .runtime_lease
            .as_ref()
            .is_some_and(|lease| !lease.load(std::sync::atomic::Ordering::Acquire))
            || self.app.as_ref().is_some_and(|app| {
                app.state::<crate::workspace::WorkspaceState>().generation()
                    != self.workspace_generation
            })
        {
            return Err("[extension.generation] Runtime or workspace authorization expired".into());
        }
        Ok(())
    }

    fn is_granted(&self, permission: &str) -> bool {
        self.require(permission) == Ok(ContextPermissionState::Granted)
    }

    /// 权限强制点的统一出口：已授权放行；未决定返回 `[permission.required:<perm>]`，
    /// 已拒绝返回 `[permission.denied:<perm>]`。前端解析前缀后弹出通用授权弹窗并重试，
    /// 扩展侧则拿到"被拒绝"与"等待授权"可区分的明确错误。
    fn require_granted(&self, permission: &str) -> Result<(), String> {
        match self.require(permission)? {
            ContextPermissionState::Granted => Ok(()),
            ContextPermissionState::Unknown => Err(format!(
                "[permission.required:{permission}] 扩展请求 {permission} 权限，等待用户授权"
            )),
            ContextPermissionState::Denied => Err(format!(
                "[permission.denied:{permission}] 用户已拒绝 {permission} 权限"
            )),
        }
    }

    /// 工作区相对路径的安全解析（workspace 边界校验的唯一实现）。
    /// 拒绝绝对路径与任何越界（.. / 根 / 前缀）组件，返回规范化后的绝对路径。
    fn resolve_workspace_path(&self, path: &str) -> Result<std::path::PathBuf, String> {
        let root = self
            .workspace_root
            .as_ref()
            .ok_or_else(|| "尚未打开工作区".to_string())?;

        let requested = Path::new(path);
        let mut safe = true;
        for component in requested.components() {
            match component {
                Component::ParentDir
                | Component::RootDir
                | Component::Prefix(_)
                | Component::CurDir => {
                    safe = false;
                    break;
                }
                Component::Normal(_) => {}
            }
        }
        if !safe || requested.is_absolute() {
            return Err(format!("不允许读取工作区外的路径: {path}"));
        }

        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("无法解析工作区根目录 {}: {error}", root.display()))?;
        let resolved = canonical_root
            .join(requested)
            .canonicalize()
            .map_err(|error| format!("无法解析路径 {path}: {error}"))?;
        if !resolved.starts_with(&canonical_root) {
            return Err(format!("不允许读取工作区外的路径: {path}"));
        }
        Ok(resolved)
    }

    /// 向前端发起一次请求-响应交互（对话框/剪贴板/命令），阻塞等待应答。
    /// 应答为 JSON 字符串（协议见 ExtensionHostBridge）。超时返回结构化错误。
    fn request_frontend_blocking(
        &self,
        kind: &'static str,
        mut payload: serde_json::Value,
        timeout: std::time::Duration,
    ) -> Result<String, String> {
        self.require_current()?;
        let app = self
            .app
            .as_ref()
            .ok_or_else(|| "[host.unavailable] 宿主应用句柄不可用".to_string())?;
        let request_id = host_bridge::next_request_id();
        use tauri::Manager;
        let generation = app.state::<crate::workspace::WorkspaceState>().generation();
        let timeout = timeout.min(std::time::Duration::from_secs(60));
        if payload.to_string().len() > crate::resource_limits::EXTENSION_PAYLOAD_BYTES {
            return Err("[resource.limit] Host request payload exceeds limit".into());
        }
        let receiver =
            host_bridge::register(&request_id, kind, &self.extension_id, generation, timeout)?;
        payload["requestId"] = serde_json::json!(request_id);
        payload["kind"] = serde_json::json!(kind);
        payload["extensionId"] = serde_json::json!(self.extension_id);
        payload["generation"] = serde_json::json!(generation);
        if let Err(error) = app.emit("extension://host-request", payload) {
            host_bridge::cancel(&request_id);
            return Err(format!("[host.emit] {error}"));
        }
        host_bridge::wait_response(&request_id, receiver, timeout)
    }

    /// 解析前端应答 JSON（协议容错：解析失败按错误返回，扩展拿到明确原因）。
    fn parse_host_response(response: &str) -> Result<serde_json::Value, String> {
        serde_json::from_str(response)
            .map_err(|error| format!("[host.protocol] 应答解析失败: {error}"))
    }
}

impl WasiView for ExtensionContext {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

pub struct ExtensionRuntime {
    engine: Engine,
    component: wasmtime::component::Component,
    linker: Linker<ExtensionContext>,
    limits: ExtensionLimits,
    session: std::sync::Mutex<Option<(Store<ExtensionContext>, Instance)>>,
}

static SHARED_ENGINE: LazyLock<Result<Engine, String>> = LazyLock::new(|| {
    let mut config = Config::new();
    config.consume_fuel(true).epoch_interruption(true);
    config.cranelift_opt_level(wasmtime::OptLevel::Speed);
    config.parallel_compilation(true);
    let engine = Engine::new(&config).map_err(|error| format!("[wasm.engine] {error}"))?;
    let ticker = engine.clone();
    std::thread::Builder::new()
        .name("aurona-wasm-deadline".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(10));
            ticker.increment_epoch();
        })
        .map_err(|error| error.to_string())?;
    Ok(engine)
});

struct CompiledComponent {
    hash: String,
    bytes: usize,
    component: wasmtime::component::Component,
}
static COMPONENT_CACHE: LazyLock<Mutex<std::collections::VecDeque<CompiledComponent>>> =
    LazyLock::new(|| Mutex::new(std::collections::VecDeque::new()));

fn compiled_component(bytes: &[u8]) -> Result<(Engine, wasmtime::component::Component), String> {
    use sha2::{Digest, Sha256};
    let hash = format!("{:x}", Sha256::digest(bytes));
    let engine = SHARED_ENGINE.as_ref().map_err(Clone::clone)?.clone();
    let mut cache = COMPONENT_CACHE
        .lock()
        .map_err(|_| "[wasm.cache] Compilation cache unavailable")?;
    if let Some(index) = cache.iter().position(|entry| entry.hash == hash) {
        let entry = cache
            .remove(index)
            .ok_or("[wasm.cache] Cache entry disappeared")?;
        let component = entry.component.clone();
        cache.push_back(entry);
        return Ok((engine, component));
    }
    let component = wasmtime::component::Component::new(&engine, bytes)
        .map_err(|error| format!("[wasm.component] {error}"))?;
    const SOURCE_LIMIT: usize = 64 * 1024 * 1024;
    if bytes.len() <= SOURCE_LIMIT {
        while cache.len() >= 8
            || cache.iter().map(|entry| entry.bytes).sum::<usize>() + bytes.len() > SOURCE_LIMIT
        {
            cache.pop_front();
        }
        cache.push_back(CompiledComponent {
            hash,
            bytes: bytes.len(),
            component: component.clone(),
        });
    }
    Ok((engine, component))
}

impl ExtensionRuntime {
    pub fn new(component_bytes: &[u8], limits: ExtensionLimits) -> Result<Self, String> {
        // 防御性校验：空/非 wasm 字节会被 wasmtime 当作 WAT 文本解析，
        // 报出晦涩的 "expected at least one module field"；这里先给出可行动的错误。
        if component_bytes.is_empty() {
            return Err("扩展 WASM 组件为空：纯 JS 扩展需要 VSCode 兼容层提供运行时".to_string());
        }
        if !component_bytes.starts_with(b"\0asm") {
            return Err("扩展 WASM 组件无效：二进制缺少 \\0asm 魔数".to_string());
        }
        if component_bytes.len() >= 8 && component_bytes[4] == 0x01 {
            return Err(
                "扩展 WASM 是核心模块而非组件：wasm32-wasip2 打包链必须产出组件编码".to_string(),
            );
        }

        let (engine, component) = compiled_component(component_bytes)?;

        let mut linker = Linker::new(&engine);
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker)
            .map_err(|error| format!("链接扩展 WASI 兜底失败: {error}"))?;
        AuronaExtension::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
            .map_err(|error| format!("链接扩展宿主上下文失败: {error}"))?;

        Ok(Self {
            engine,
            component,
            linker,
            limits,
            session: std::sync::Mutex::new(None),
        })
    }

    /// 实例化组件并返回 (store, instance)。
    ///
    /// 注意：这里**不走** bindgen 生成的 `AuronaExtension::instantiate`。
    /// 生成的入口要求组件必须导出 world 声明的**全部**函数——而按旧版
    /// world 编译的扩展包没有 `on-action` 导出，会被整体判为实例化失败。
    /// 手动实例化 + 惰性查找导出，让 `render` 保持必选、`on-action` 可选，
    /// 实现 ABI 向后兼容（旧包继续渲染，收到交互时才得到明确报错）。
    fn instantiate(
        &self,
        mut context: ExtensionContext,
    ) -> Result<(Store<ExtensionContext>, Instance), String> {
        context.limits = self.limits.store_limits();

        let mut store = Store::new(&self.engine, context);
        store.set_epoch_deadline(3000);
        store.limiter(|state| &mut state.limits);
        store
            .set_fuel(INSTANTIATE_FUEL)
            .map_err(|error| format!("设置实例化燃料失败: {error}"))?;

        let instance = self
            .linker
            .instantiate(&mut store, &self.component)
            .map_err(|error| format!("实例化扩展失败: {error:#}"))?;
        store
            .set_fuel(self.limits.fuel)
            .map_err(|error| format!("设置执行燃料失败: {error}"))?;
        Ok((store, instance))
    }

    fn parse_export_name(name: &'static str) -> ItemName {
        name.parse().expect("内置导出名必须能够解析为 ItemName")
    }

    fn with_instance<T>(
        &self,
        mut context: ExtensionContext,
        call: impl FnOnce(&mut Store<ExtensionContext>, Instance) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut session = self
            .session
            .lock()
            .map_err(|_| "[extension.session] Runtime session unavailable")?;
        let mut previous = session.take();
        if previous.as_ref().is_some_and(|(store, _)| {
            !self.limits.persistent
                || store.data().workspace_generation != context.workspace_generation
                || store.data().extension_id != context.extension_id
        }) {
            if let Some((mut store, instance)) = previous.take() {
                Self::dispose_instance(&mut store, instance);
            }
        }
        let (mut store, instance) = if let Some((mut store, instance)) = previous {
            // Keep WASI handles/resource table and limiter owned by the live instance.
            let old = store.data_mut();
            std::mem::swap(&mut old.wasi, &mut context.wasi);
            std::mem::swap(&mut old.table, &mut context.table);
            std::mem::swap(&mut old.limits, &mut context.limits);
            *old = context;
            (store, instance)
        } else {
            self.instantiate(context)?
        };
        store
            .set_fuel(self.limits.fuel)
            .map_err(|error| error.to_string())?;
        store.set_epoch_deadline(3000);
        let result = call(&mut store, instance);
        // Traps discard the session; a poisoned instance is never used again.
        if self.limits.persistent && result.is_ok() {
            *session = Some((store, instance));
        }
        result
    }

    fn dispose_instance(store: &mut Store<ExtensionContext>, instance: Instance) {
        let _ = store.set_fuel(DEFAULT_FUEL);
        store.set_epoch_deadline(100);
        if let Ok(action) = instance
            .get_typed_func::<(&str, &str), (Result<RenderOutput, String>,)>(
                &mut *store,
                Self::parse_export_name("aurona:extensions/render.on-action"),
            )
        {
            let _ = action.call(&mut *store, ("__aurona_deactivate", ""));
        }
        let _ = store.data().emit_to_frontend(
            "extension://status-message",
            serde_json::json!({
                "extensionId": store.data().extension_id,
                "message": "", "timeoutMs": 0,
            }),
        );
    }

    /// 把 wasmtime trap 归类为对用户友好的沙箱错误提示（§5.3.1：fuel 耗尽要优雅报错）。
    fn friendly_call_error(stage: &str, error: wasmtime::Error) -> String {
        let text = format!("{error:#}");
        let lowered = text.to_lowercase();
        if lowered.contains("fuel") {
            return format!(
                "{stage}: 扩展执行超出沙箱燃料配额（疑似死循环或超大规模计算），已被强制终止"
            );
        }
        if lowered.contains("memory") && (lowered.contains("minimum") || lowered.contains("grow")) {
            return format!("{stage}: 扩展内存用量超出沙箱配额，已被强制终止");
        }
        format!("{stage}: {text}")
    }

    pub fn render(
        &self,
        context: ExtensionContext,
        markdown: String,
    ) -> Result<RenderOutput, String> {
        self.with_instance(context, |store, instance| {
            let render_func: TypedFunc<(&RenderInput,), (Result<RenderOutput, String>,)> = instance
                .get_typed_func(
                    &mut *store,
                    Self::parse_export_name("aurona:extensions/render.render"),
                )
                .map_err(|error| format!("扩展缺少 render 导出: {error:#}"))?;
            let input = RenderInput { markdown };
            let (result,) = render_func
                .call(&mut *store, (&input,))
                .map_err(|error| Self::friendly_call_error("扩展渲染", error))?;
            result.map_err(|error| format!("扩展渲染返回错误: {error}"))
        })
    }

    /// 请求-响应交互入口：把用户在渲染视图中的动作交给扩展，拿回下一帧渲染。
    ///
    /// 组件默认无状态；兼容运行时保留工作区内会话。按旧版 world 编译、
    /// 没有 `on-action` 导出的扩展会得到明确的"不支持交互"错误。
    pub fn on_action(
        &self,
        context: ExtensionContext,
        action_id: String,
        payload: String,
    ) -> Result<RenderOutput, String> {
        self.with_instance(context, |store, instance| {
            let action_func: TypedFunc<(&str, &str), (Result<RenderOutput, String>,)> = instance
                .get_typed_func(
                    &mut *store,
                    Self::parse_export_name("aurona:extensions/render.on-action"),
                )
                .map_err(|_| {
                    "该扩展未提供交互处理能力（缺少 on-action 导出），请更新扩展后重试".to_string()
                })?;
            let (result,) = action_func
                .call(&mut *store, (&action_id, &payload))
                .map_err(|error| Self::friendly_call_error("扩展交互", error))?;
            result.map_err(|error| format!("扩展 on-action 返回错误: {error}"))
        })
    }
}

impl Drop for ExtensionRuntime {
    fn drop(&mut self) {
        if let Ok(session) = self.session.get_mut() {
            if let Some((mut store, instance)) = session.take() {
                Self::dispose_instance(&mut store, instance);
            }
        }
    }
}

#[cfg(test)]
mod tests;
