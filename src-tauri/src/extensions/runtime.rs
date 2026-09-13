use std::collections::HashMap;
use std::path::{Component, Path};

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
const DEFAULT_MEMORY_BYTES: usize = 256 * 1024 * 1024;
const DEFAULT_FUEL: u64 = 4_000_000_000;
const INSTANTIATE_FUEL: u64 = 500_000_000;
const MAX_WORKSPACE_READ_BYTES: u64 = 4 * 1024 * 1024;
const MAX_WORKSPACE_WRITE_BYTES: usize = 10 * 1024 * 1024;
const MAX_WORKSPACE_LIST_ENTRIES: u32 = 1000;
const MAX_FLIUNO_ITEMS: usize = 50;
const MAX_GIT_LOG_ENTRIES: usize = 100;

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

#[derive(Debug, Clone, Copy)]
pub struct ExtensionLimits {
    pub memory_bytes: usize,
    pub fuel: u64,
}

impl Default for ExtensionLimits {
    fn default() -> Self {
        Self {
            memory_bytes: DEFAULT_MEMORY_BYTES,
            fuel: DEFAULT_FUEL,
        }
    }
}

/// Per-call context supplied to the WASM component. The host decides what the
/// extension may see; the component itself cannot reach beyond these values.
pub struct ExtensionContext {
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
            limits: StoreLimitsBuilder::new()
                .memory_size(DEFAULT_MEMORY_BYTES)
                .table_elements(1024)
                .instances(16)
                .memories(16)
                .build(),
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
        let app = self
            .app
            .as_ref()
            .ok_or_else(|| "宿主应用句柄不可用".to_string())?;
        app.emit(event, payload)
            .map_err(|error| format!("发送宿主事件失败: {error}"))
    }

    fn ensure_git_read(&self) -> Result<(), String> {
        if self.require("git.read")? != ContextPermissionState::Granted {
            return Err("缺少 git.read 权限".to_string());
        }
        Ok(())
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
        if self.require("git.write")? != ContextPermissionState::Granted {
            return Err("缺少 git.write 权限".to_string());
        }
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
        super::permissions::ensure_requestable(permission)?;
        Ok(self
            .permissions
            .get(permission)
            .copied()
            .unwrap_or(ContextPermissionState::Unknown))
    }

    fn is_granted(&self, permission: &str) -> bool {
        self.require(permission) == Ok(ContextPermissionState::Granted)
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

impl aurona::extensions::context::Host for ExtensionContext {
    fn get_environment(&mut self) -> ContextEnvironment {
        ContextEnvironment {
            theme: self.environment.theme.clone(),
            accent_color: self.environment.accent_color.clone(),
            color_scheme: self.environment.color_scheme.clone(),
            locale: self.environment.locale.clone(),
            font_weight: self.environment.font_weight.clone(),
            font_size: self.environment.font_size.clone(),
            app_version: self.environment.app_version.clone(),
            platform: self.environment.platform.clone(),
        }
    }

    fn get_editor_snapshot(&mut self) -> ContextEditorSnapshot {
        let granted = self.is_granted("editor.current.read");
        match &self.editor_snapshot {
            Some(snapshot) if granted => ContextEditorSnapshot {
                path: snapshot.path.clone(),
                language: snapshot.language.clone(),
                content: snapshot.content.clone(),
                version: snapshot.version,
            },
            _ => ContextEditorSnapshot {
                path: None,
                language: None,
                content: None,
                version: 0,
            },
        }
    }

    fn get_editor_selection(&mut self) -> Option<ContextSelectionRange> {
        if self.is_granted("editor.current.read") {
            self.editor_selection
        } else {
            None
        }
    }

    fn get_editor_selection_text(&mut self) -> Option<String> {
        if self.is_granted("editor.current.read") {
            self.editor_selection_text.clone()
        } else {
            None
        }
    }

    fn get_workspace_info(&mut self) -> ContextWorkspaceInfo {
        if self.is_granted("workspace.read") {
            if let Some(root) = self.workspace_root.as_ref() {
                let root_name = root
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string());
                return ContextWorkspaceInfo {
                    has_workspace: true,
                    name: self.workspace_name.clone().or_else(|| root_name.clone()),
                    root_name,
                };
            }
        }
        ContextWorkspaceInfo {
            has_workspace: false,
            name: None,
            root_name: None,
        }
    }

    fn request_permission(&mut self, permission: String) -> ContextPermissionState {
        // WIT 契约只能返回三态：对未开放的权限返回 Denied，
        // 具体原因由后续的能力调用（如 write-workspace-file）给出明确错误。
        self.require(&permission)
            .unwrap_or(ContextPermissionState::Denied)
    }

    fn read_workspace_file(&mut self, path: String) -> Result<String, String> {
        if self.require("workspace.read")? != ContextPermissionState::Granted {
            return Err("缺少 workspace.read 权限".to_string());
        }
        let root = self
            .workspace_root
            .as_ref()
            .ok_or_else(|| "尚未打开工作区".to_string())?;

        let requested = Path::new(&path);
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
        if !resolved.is_file() {
            return Err(format!("不是文件: {path}"));
        }

        let metadata = std::fs::metadata(&resolved)
            .map_err(|error| format!("无法读取文件 {path}: {error}"))?;
        if metadata.len() > MAX_WORKSPACE_READ_BYTES {
            return Err(format!("文件过大，拒绝读取: {path}"));
        }

        std::fs::read_to_string(&resolved).map_err(|error| format!("读取文件 {path} 失败: {error}"))
    }

    fn write_workspace_file(&mut self, path: String, content: String) -> Result<bool, String> {
        // 写文件必须显式持有 workspace.write：read 不能顶替 write。
        // 修复此前"设置里的 workspace.write 开关对行为零影响"的装饰性问题。
        if self.require("workspace.write")? != ContextPermissionState::Granted {
            return Err("缺少 workspace.write 权限".to_string());
        }
        let root = self
            .workspace_root
            .as_ref()
            .ok_or_else(|| "尚未打开工作区".to_string())?;

        let requested = Path::new(&path);
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
            return Err(format!("不允许写入工作区外的路径: {path}"));
        }

        // 禁止写入 .git 等敏感目录
        for part in requested.iter() {
            let part_str = part.to_string_lossy();
            if part_str.eq_ignore_ascii_case(".git") {
                return Err(format!("禁止修改系统版本控制目录: {path}"));
            }
        }

        if content.len() > MAX_WORKSPACE_WRITE_BYTES {
            return Err(format!("写入内容过大（超过 10MB 限制）: {path}"));
        }

        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("无法解析工作区根目录 {}: {error}", root.display()))?;

        let target_path = canonical_root.join(requested);
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
        }

        std::fs::write(&target_path, content.as_bytes())
            .map_err(|error| format!("写入文件 {path} 失败: {error}"))?;

        Ok(true)
    }

    fn list_workspace_files(
        &mut self,
        directory: String,
        max_count: u32,
    ) -> Result<Vec<ContextFileEntry>, String> {
        if self.require("workspace.read")? != ContextPermissionState::Granted {
            return Err("缺少 workspace.read 权限".to_string());
        }
        let root = self
            .workspace_root
            .as_ref()
            .ok_or_else(|| "尚未打开工作区".to_string())?;

        let dir_path = Path::new(&directory);
        let mut safe = true;
        for component in dir_path.components() {
            match component {
                Component::ParentDir | Component::Prefix(_) => {
                    safe = false;
                    break;
                }
                _ => {}
            }
        }
        if !safe {
            return Err(format!("不安全的工作区目录路径: {directory}"));
        }

        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("无法解析工作区根目录 {}: {error}", root.display()))?;
        let target_dir = if directory.is_empty() || directory == "." {
            canonical_root.clone()
        } else {
            canonical_root
                .join(dir_path)
                .canonicalize()
                .map_err(|error| format!("无法解析工作区目录 {directory}: {error}"))?
        };

        if !target_dir.starts_with(&canonical_root) {
            return Err(format!("不允许访问工作区外的目录: {directory}"));
        }
        if !target_dir.is_dir() {
            return Err(format!("指定路径不是目录: {directory}"));
        }

        let limit = max_count.min(MAX_WORKSPACE_LIST_ENTRIES) as usize;
        let mut entries = Vec::new();
        let read_dir = std::fs::read_dir(&target_dir)
            .map_err(|error| format!("列出目录 {directory} 失败: {error}"))?;

        for entry in read_dir {
            if entries.len() >= limit {
                break;
            }
            if let Ok(entry) = entry {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
                entries.push(ContextFileEntry {
                    name,
                    is_directory: is_dir,
                    size_bytes,
                });
            }
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    fn watch_workspace_path(&mut self, path: String) -> Result<u64, String> {
        let root = self
            .workspace_root
            .as_ref()
            .ok_or_else(|| "当前未打开工作区".to_string())?;
        if self.require("workspace.read")? != ContextPermissionState::Granted {
            return Err("缺少 workspace.read 权限".to_string());
        }

        let rel_path = Path::new(&path);
        let mut safe = true;
        for comp in rel_path.components() {
            match comp {
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    safe = false;
                    break;
                }
                _ => {}
            }
        }
        if !safe {
            return Err(format!("不安全的文件监听路径: {path}"));
        }

        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("无法解析工作区根目录 {}: {error}", root.display()))?;
        let target = if path.is_empty() || path == "." {
            canonical_root.clone()
        } else {
            canonical_root.join(rel_path)
        };

        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        std::hash::Hash::hash(&target.to_string_lossy(), &mut hasher);
        let watch_id = std::hash::Hasher::finish(&hasher);
        Ok(watch_id)
    }

    fn unwatch_workspace_path(&mut self, _watch_id: u64) -> Result<bool, String> {
        Ok(true)
    }

    fn log(&mut self, level: String, message: String) {
        eprintln!("[aurona-extension][{level}] {message}");
    }

    fn show_notification(&mut self, level: String, message: String) -> Result<bool, String> {
        eprintln!("[aurona-notification][{level}] {message}");
        Ok(true)
    }

    fn write_clipboard(&mut self, _text: String) -> Result<bool, String> {
        // 占位实现：本版本未提供剪贴板通路。明确报错而不是假装成功。
        self.require("clipboard.access")?;
        Err("剪贴板写入能力在当前版本尚未开放".to_string())
    }

    fn read_clipboard(&mut self) -> Result<String, String> {
        self.require("clipboard.access")?;
        Err("剪贴板读取能力在当前版本尚未开放".to_string())
    }

    fn get_icon_svg(&mut self, name: String) -> Option<String> {
        // 标准 24x24 线性图标（stroke: currentColor）。按需扩充；
        // 图标名与前端 IconManager 的常用名保持一致，扩展侧可放心引用。
        const OPEN: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">";
        let path = match name.as_str() {
            "check" => "<polyline points=\"20 6 9 17 4 12\"/>",
            "trash" => "<path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/>",
            "plus" => "<line x1=\"12\" y1=\"5\" x2=\"12\" y2=\"19\"/><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/>",
            "clipboard" => "<path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"/><rect x=\"8\" y=\"2\" width=\"8\" height=\"4\" rx=\"1\" ry=\"1\"/>",
            "calendar" => "<rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\" ry=\"2\"/><line x1=\"16\" y1=\"2\" x2=\"16\" y2=\"6\"/><line x1=\"8\" y1=\"2\" x2=\"8\" y2=\"6\"/><line x1=\"3\" y1=\"10\" x2=\"21\" y2=\"10\"/>",
            "code" => "<polyline points=\"16 18 22 12 16 6\"/><polyline points=\"8 6 2 12 8 18\"/>",
            "zap" => "<polygon points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"/>",
            "terminal" => "<polyline points=\"4 17 10 11 4 5\"/><line x1=\"12\" y1=\"19\" x2=\"20\" y2=\"19\"/>",
            "search" => "<circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" y1=\"21\" x2=\"16.65\" y2=\"16.65\"/>",
            "settings" => "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z\"/>",
            "home" => "<path d=\"M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/><polyline points=\"9 22 9 12 15 12 15 22\"/>",
            "clock" => "<circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/>",
            "user" => "<path d=\"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/>",
            "file" => "<path d=\"M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><polyline points=\"13 2 13 9 20 9\"/>",
            "folder" => "<path d=\"M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z\"/>",
            "star" => "<polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"/>",
            "x" => "<line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/>",
            _ => return None,
        };
        Some(format!("{OPEN}{path}</svg>"))
    }

    fn execute_command(
        &mut self,
        command_id: String,
        _arguments: Vec<String>,
    ) -> Result<String, String> {
        eprintln!("[aurona-command] execute: {command_id}");
        Ok("ok".to_string())
    }

    fn set_status_message(&mut self, message: String, _timeout_ms: u32) -> Result<bool, String> {
        eprintln!("[aurona-status-message] {message}");
        Ok(true)
    }

    fn insert_editor_text(&mut self, text: String) -> Result<bool, String> {
        // 写入通路：require 权限后，把插入请求以事件交给前端编辑器桥
        // （ExtensionEditorBridge → EditorAdapter → 活动引擎）。
        if self.require("editor.current.write")? != ContextPermissionState::Granted {
            return Err("缺少 editor.current.write 权限".to_string());
        }
        self.emit_to_frontend(
            "extension://editor/insert-text",
            serde_json::json!({
                "extensionId": self.extension_id,
                "text": text,
            }),
        )?;
        Ok(true)
    }

    fn reveal_editor_line(&mut self, line: u32) -> Result<bool, String> {
        // 定位到某行属于编辑器操控，与插入文本同属 editor.current.write。
        if self.require("editor.current.write")? != ContextPermissionState::Granted {
            return Err("缺少 editor.current.write 权限".to_string());
        }
        self.emit_to_frontend(
            "extension://editor/reveal-line",
            serde_json::json!({
                "extensionId": self.extension_id,
                "line": line,
            }),
        )?;
        Ok(true)
    }

    fn get_sdk_version(&mut self) -> u32 {
        1
    }

    fn contribute_fliuno_items(
        &mut self,
        items: Vec<aurona::extensions::context::FliunoItem>,
    ) -> Result<bool, String> {
        // 与 request-permission 走同一条 require() 路径，
        // 修复此前"扩展主动请求 fliuno.search 恒为 Denied，但宿主却单独放行"的双轨问题。
        if self.require("fliuno.search")? != ContextPermissionState::Granted {
            return Err("缺少 fliuno.search 权限".to_string());
        }
        if items.len() > MAX_FLIUNO_ITEMS {
            return Err(format!(
                "Fliuno 贡献项超出上限（最多 {MAX_FLIUNO_ITEMS} 个）"
            ));
        }
        // bindgen 生成类型未实现 Serialize：映射为宿主侧结构后再发事件，
        // 前端 ExtensionFliunoRegistry 把它们注册为该扩展的搜索源。
        let payload: Vec<FliunoContributedItem> = items
            .into_iter()
            .map(|item| FliunoContributedItem {
                id: item.id,
                title: item.title,
                subtitle: item.subtitle,
                icon: item.icon,
                action: item.action,
            })
            .collect();
        self.emit_to_frontend(
            "extension://fliuno/contribute-items",
            serde_json::json!({
                "extensionId": self.extension_id,
                "items": payload,
            }),
        )?;
        Ok(true)
    }

    fn git_repository_info(&mut self) -> Option<ContextGitRepoInfo> {
        // WIT 契约返回 option：仓库不存在或查询失败时统一给 None，
        // 权限不足同样表现为 None（不泄露仓库状态）。
        let result = (|| -> Result<ContextGitRepoInfo, String> {
            let root = self.git_workspace_root()?;
            let root_str = root.to_string_lossy().to_string();
            if !crate::commands::git::git_check_is_repo_internal(root_str.clone())? {
                return Err("not a repository".to_string());
            }
            let branch = crate::commands::git::git_current_branch_internal(root_str.clone())?;
            let has_remote =
                !crate::commands::git::git_get_remote_internal(root_str.clone())?.is_empty();
            let (ahead, behind) =
                crate::commands::git::git_tracking_status_internal(root_str.clone())?;
            Ok(ContextGitRepoInfo {
                root: root_str,
                branch,
                ahead,
                behind,
                has_remote,
            })
        })();
        match result {
            Ok(info) => Some(info),
            Err(error) => {
                eprintln!(
                    "[aurona-git] 扩展 {} 查询仓库信息失败: {error}",
                    self.extension_id
                );
                None
            }
        }
    }

    fn git_status(&mut self) -> Result<Vec<ContextGitFileStatus>, String> {
        let root = self.git_workspace_root()?;
        let files = crate::commands::git::git_status_internal(root.to_string_lossy().to_string())?;
        Ok(files
            .into_iter()
            .map(|file| ContextGitFileStatus {
                path: file.path,
                change: file.status,
                staged: file.is_staged,
            })
            .collect())
    }

    fn git_log(&mut self, limit: u32) -> Result<Vec<ContextGitLogEntry>, String> {
        let root = self.git_workspace_root()?;
        let mut commits =
            crate::commands::git::git_log_internal(root.to_string_lossy().to_string())?;
        // git log 返回新在前；截断到扩展请求的条数并限制绝对上限。
        let limit = (limit as usize).min(MAX_GIT_LOG_ENTRIES);
        commits.truncate(limit);
        Ok(commits
            .into_iter()
            .map(|commit| ContextGitLogEntry {
                hash: commit.hash,
                author: commit.author,
                message: commit.message,
                date: commit.date,
            })
            .collect())
    }

    fn git_diff(&mut self, path: String) -> Result<String, String> {
        let root = self.git_workspace_root()?;
        let root_str = root.to_string_lossy().to_string();
        crate::commands::git::git_worktree_diff_internal(root_str, path, false)
    }

    fn git_stage(&mut self, paths: Vec<String>) -> Result<bool, String> {
        let root = self.git_write_root()?;
        let root_str = root.to_string_lossy().to_string();
        for path in &paths {
            crate::commands::git::git_add_internal(root_str.clone(), path.clone())?;
        }
        Ok(true)
    }

    fn git_unstage(&mut self, paths: Vec<String>) -> Result<bool, String> {
        let root = self.git_write_root()?;
        let root_str = root.to_string_lossy().to_string();
        for path in &paths {
            crate::commands::git::git_unstage_internal(root_str.clone(), path.clone())?;
        }
        Ok(true)
    }

    fn git_commit(&mut self, message: String) -> Result<bool, String> {
        let root = self.git_write_root()?;
        if message.trim().is_empty() {
            return Err("提交信息不能为空".to_string());
        }
        crate::commands::git::git_commit_internal(root.to_string_lossy().to_string(), message)?;
        Ok(true)
    }

    fn storage_get(&mut self, key: String) -> Result<Option<String>, String> {
        // 沙箱键值存储：每个扩展按 id 分离保存在 APPDATA 下
        let storage_dir = self.get_storage_dir();
        let file_path = storage_dir.join(format!("{key}.json"));
        if file_path.exists() {
            let content =
                std::fs::read_to_string(&file_path).map_err(|e| format!("读取存储项失败: {e}"))?;
            Ok(Some(content))
        } else {
            Ok(None)
        }
    }

    fn storage_set(&mut self, key: String, value: String) -> Result<bool, String> {
        let storage_dir = self.get_storage_dir();
        std::fs::create_dir_all(&storage_dir).map_err(|e| format!("创建存储目录失败: {e}"))?;
        let file_path = storage_dir.join(format!("{key}.json"));
        std::fs::write(&file_path, value).map_err(|e| format!("写入存储项失败: {e}"))?;
        Ok(true)
    }

    fn storage_delete(&mut self, key: String) -> Result<bool, String> {
        let storage_dir = self.get_storage_dir();
        let file_path = storage_dir.join(format!("{key}.json"));
        if file_path.exists() {
            let _ = std::fs::remove_file(file_path);
        }
        Ok(true)
    }

    fn storage_list_keys(&mut self) -> Result<Vec<String>, String> {
        let storage_dir = self.get_storage_dir();
        if !storage_dir.exists() {
            return Ok(Vec::new());
        }
        let mut keys = Vec::new();
        if let Ok(entries) = std::fs::read_dir(storage_dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if let Some(stripped) = name.strip_suffix(".json") {
                        keys.push(stripped.to_string());
                    }
                }
            }
        }
        Ok(keys)
    }

    fn show_dialog_confirm(&mut self, title: String, message: String) -> Result<bool, String> {
        eprintln!("[aurona-dialog-confirm] {title}: {message}");
        Ok(true)
    }

    fn storage_clear(&mut self) -> Result<bool, String> {
        let storage_dir = self.get_storage_dir();
        if !storage_dir.exists() {
            return Ok(true);
        }
        std::fs::remove_dir_all(&storage_dir).map_err(|e| format!("清空存储失败: {e}"))?;
        Ok(true)
    }
}

pub struct ExtensionRuntime {
    engine: Engine,
    component: wasmtime::component::Component,
    linker: Linker<ExtensionContext>,
    limits: ExtensionLimits,
}

impl ExtensionRuntime {
    pub fn new(component_bytes: &[u8], limits: ExtensionLimits) -> Result<Self, String> {
        let mut config = Config::new();
        config.consume_fuel(true);
        config.cranelift_opt_level(wasmtime::OptLevel::Speed);
        config.parallel_compilation(true);

        let engine =
            Engine::new(&config).map_err(|error| format!("Wasmtime 引擎初始化失败: {error}"))?;
        let component = wasmtime::component::Component::new(&engine, component_bytes)
            .map_err(|error| format!("WASM 组件无效: {error}"))?;

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
        context.limits = StoreLimitsBuilder::new()
            .memory_size(self.limits.memory_bytes)
            .table_elements(1024)
            .instances(16)
            .memories(16)
            .build();

        let mut store = Store::new(&self.engine, context);
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
        let (mut store, instance) = self.instantiate(context)?;
        let render_func: TypedFunc<(&RenderInput,), (Result<RenderOutput, String>,)> = instance
            .get_typed_func(
                &mut store,
                Self::parse_export_name("aurona:extensions/render.render"),
            )
            .map_err(|error| format!("扩展缺少 render 导出: {error:#}"))?;
        let input = RenderInput { markdown };
        let (result,) = render_func
            .call(&mut store, (&input,))
            .map_err(|error| Self::friendly_call_error("扩展渲染", error))?;
        result.map_err(|error| format!("扩展渲染返回错误: {error}"))
    }

    /// 请求-响应交互入口：把用户在渲染视图中的动作交给扩展，拿回下一帧渲染。
    ///
    /// 扩展跨调用无状态（要持久化请用 storage API）。按旧版 world 编译、
    /// 没有 `on-action` 导出的扩展会得到明确的"不支持交互"错误。
    pub fn on_action(
        &self,
        context: ExtensionContext,
        action_id: String,
        payload: String,
    ) -> Result<RenderOutput, String> {
        let (mut store, instance) = self.instantiate(context)?;
        let action_func: TypedFunc<(&str, &str), (Result<RenderOutput, String>,)> = instance
            .get_typed_func(
                &mut store,
                Self::parse_export_name("aurona:extensions/render.on-action"),
            )
            .map_err(|_| {
                "该扩展未提供交互处理能力（缺少 on-action 导出），请更新扩展后重试".to_string()
            })?;
        let (result,) = action_func
            .call(&mut store, (&action_id, &payload))
            .map_err(|error| Self::friendly_call_error("扩展交互", error))?;
        result.map_err(|error| format!("扩展 on-action 返回错误: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aurona::extensions::context::Host as _;
    use std::path::PathBuf;

    fn test_environment() -> ContextEnvironment {
        ContextEnvironment {
            theme: "coral-sunset".to_string(),
            accent_color: "coral".to_string(),
            color_scheme: "dark".to_string(),
            locale: "zh-CN".to_string(),
            font_weight: "normal".to_string(),
            font_size: "default".to_string(),
            app_version: "0.3.13".to_string(),
            platform: "windows".to_string(),
        }
    }

    fn test_context(workspace_root: Option<PathBuf>) -> ExtensionContext {
        ExtensionContext::new(workspace_root, test_environment())
    }

    fn grant(context: &mut ExtensionContext, permission: &str) {
        context
            .permissions
            .insert(permission.to_string(), ContextPermissionState::Granted);
    }

    fn deny(context: &mut ExtensionContext, permission: &str) {
        context
            .permissions
            .insert(permission.to_string(), ContextPermissionState::Denied);
    }

    #[test]
    fn editor_content_requires_grant() {
        let mut context = test_context(None);
        context.editor_snapshot = Some(ContextEditorSnapshot {
            path: Some("/repo/README.md".to_string()),
            language: Some("markdown".to_string()),
            content: Some("# secret".to_string()),
            version: 3,
        });
        deny(&mut context, "editor.current.read");
        let snapshot = context.get_editor_snapshot();
        assert_eq!(snapshot.content, None);
        assert_eq!(snapshot.version, 0);

        let mut context = test_context(None);
        context.editor_snapshot = Some(ContextEditorSnapshot {
            path: Some("/repo/README.md".to_string()),
            language: Some("markdown".to_string()),
            content: Some("# visible".to_string()),
            version: 3,
        });
        grant(&mut context, "editor.current.read");
        let snapshot = context.get_editor_snapshot();
        assert_eq!(snapshot.content.as_deref(), Some("# visible"));
        assert_eq!(snapshot.version, 3);
    }

    #[test]
    fn unavailable_permissions_report_clearly_instead_of_denied() {
        let context = test_context(None);
        // terminal.execute 已登记但当前版本未开放：应给出"尚未开放"，
        // 与"用户明确拒绝"区分开
        let error = context.require("terminal.execute").unwrap_err();
        assert!(error.contains("尚未开放"), "{error}");
        // request-permission 在 WIT 三态约束下只能回退为 Denied
        let mut context = test_context(None);
        assert_eq!(
            context.request_permission("terminal.execute".to_string()),
            ContextPermissionState::Denied
        );
    }

    #[test]
    fn rejects_workspace_escape() {
        let temp =
            std::env::temp_dir().join(format!("aurona-ext-workspace-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("file.txt"), b"ok").unwrap();
        let mut host = test_context(Some(temp.clone()));
        grant(&mut host, "workspace.read");
        assert_eq!(
            host.read_workspace_file("file.txt".to_string()),
            Ok("ok".to_string())
        );
        assert!(host
            .read_workspace_file("../secret.txt".to_string())
            .is_err());
        assert!(host
            .read_workspace_file("C:\\Windows\\win.ini".to_string())
            .is_err());
        assert!(host
            .read_workspace_file("//server/share/file".to_string())
            .is_err());
        assert_eq!(
            host.read_workspace_file("file.txt".to_string()),
            Ok("ok".to_string())
        );
        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn write_workspace_file_enforces_safety() {
        let temp = std::env::temp_dir().join(format!("aurona-ext-write-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        let mut host = test_context(Some(temp.clone()));

        // 只有 workspace.read 时必须拒绝写入：read 不能顶替 write
        grant(&mut host, "workspace.read");
        let error = host
            .write_workspace_file(".aurona/planner.json".to_string(), "{}".to_string())
            .unwrap_err();
        assert!(error.contains("workspace.write"), "{error}");

        // 显式持有 workspace.write 后才能写
        grant(&mut host, "workspace.write");
        assert_eq!(
            host.write_workspace_file(
                ".aurona/planner.json".to_string(),
                "{\"tasks\":[]}".to_string()
            ),
            Ok(true)
        );
        assert!(temp.join(".aurona").join("planner.json").exists());
        let content = std::fs::read_to_string(temp.join(".aurona").join("planner.json")).unwrap();
        assert_eq!(content, "{\"tasks\":[]}");

        // 拒绝路径逃逸
        assert!(host
            .write_workspace_file("../escape.txt".to_string(), "bad".to_string())
            .is_err());
        if cfg!(windows) {
            // Windows 上盘符路径是绝对路径；Unix 上反斜杠只是普通文件名字符
            assert!(host
                .write_workspace_file("C:\\Windows\\system.txt".to_string(), "bad".to_string())
                .is_err());
        } else {
            assert!(host
                .write_workspace_file("/etc/passwd".to_string(), "bad".to_string())
                .is_err());
        }

        // 拒绝写入 .git 系统敏感目录
        assert!(host
            .write_workspace_file(".git/config".to_string(), "bad".to_string())
            .is_err());

        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn environment_reports_metadata() {
        let mut context = test_context(None);
        context.environment.app_version = "0.3.13".to_string();
        context.environment.platform = "windows".to_string();
        let env = context.get_environment();
        assert_eq!(env.theme, "coral-sunset");
        assert_eq!(env.locale, "zh-CN");
        assert_eq!(env.app_version, "0.3.13");
        assert_eq!(env.platform, "windows");
    }

    #[test]
    fn workspace_info_and_list_files_requires_grant() {
        let temp = std::env::temp_dir().join(format!("aurona-ext-list-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("a.md"), b"test").unwrap();
        std::fs::create_dir(temp.join("sub")).unwrap();

        let mut host = test_context(Some(temp.clone()));
        host.workspace_name = Some("MyWorkspace".to_string());
        deny(&mut host, "workspace.read");

        let info = host.get_workspace_info();
        assert!(!info.has_workspace);
        assert_eq!(info.name, None);
        assert!(host.list_workspace_files(".".to_string(), 10).is_err());

        grant(&mut host, "workspace.read");
        let info = host.get_workspace_info();
        assert!(info.has_workspace);
        assert_eq!(info.name.as_deref(), Some("MyWorkspace"));

        let files = host.list_workspace_files(".".to_string(), 10).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].name, "a.md");
        assert!(!files[0].is_directory);
        assert_eq!(files[1].name, "sub");
        assert!(files[1].is_directory);

        assert!(host.list_workspace_files("../".to_string(), 10).is_err());
        std::fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn invalid_component_is_rejected() {
        let result = ExtensionRuntime::new(b"not a wasm component", ExtensionLimits::default());
        assert!(result.is_err());
    }
}
