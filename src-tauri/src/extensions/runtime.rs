use std::path::{Component, Path};

use wasmtime::component::{bindgen, HasSelf, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store, StoreLimits, StoreLimitsBuilder};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

bindgen!({
    world: "aurona-extension",
    path: "../Extensions/wit/world.wit",
});

pub use aurona::extensions::context::{
    EditorSnapshot as ContextEditorSnapshot, Environment as ContextEnvironment,
    FileEntry as ContextFileEntry, PermissionState as ContextPermissionState,
    SelectionRange as ContextSelectionRange, WorkspaceInfo as ContextWorkspaceInfo,
};
pub use exports::aurona::extensions::render::{RenderInput, RenderOutput};

const DEFAULT_MEMORY_BYTES: usize = 64 * 1024 * 1024;
const DEFAULT_FUEL: u64 = 10_000_000;
const MAX_WORKSPACE_READ_BYTES: u64 = 4 * 1024 * 1024;
const MAX_WORKSPACE_WRITE_BYTES: usize = 10 * 1024 * 1024;
const MAX_WORKSPACE_LIST_ENTRIES: u32 = 1000;

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
    pub environment: ContextEnvironment,
    pub editor_snapshot: Option<ContextEditorSnapshot>,
    pub editor_selection: Option<ContextSelectionRange>,
    pub editor_permission: ContextPermissionState,
    pub workspace_permission: ContextPermissionState,
    pub fliuno_permission: ContextPermissionState,
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
            environment,
            editor_snapshot: None,
            editor_selection: None,
            editor_permission: ContextPermissionState::Unknown,
            workspace_permission: ContextPermissionState::Unknown,
            fliuno_permission: ContextPermissionState::Unknown,
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

    fn permission_state(&self, permission: &str) -> ContextPermissionState {
        match permission {
            "editor.current.read" => self.editor_permission,
            "workspace.read" => self.workspace_permission,
            _ => ContextPermissionState::Denied,
        }
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
        let granted = self.editor_permission == ContextPermissionState::Granted;
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
        if self.editor_permission == ContextPermissionState::Granted {
            self.editor_selection
        } else {
            None
        }
    }

    fn get_workspace_info(&mut self) -> ContextWorkspaceInfo {
        if self.workspace_permission == ContextPermissionState::Granted {
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
        self.permission_state(&permission)
    }

    fn read_workspace_file(&mut self, path: String) -> Result<String, String> {
        if self.workspace_permission != ContextPermissionState::Granted {
            return Err("workspace.read is not granted".to_string());
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
        if self.workspace_permission != ContextPermissionState::Granted {
            return Err("workspace.write or workspace.read is not granted".to_string());
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
        if self.workspace_permission != ContextPermissionState::Granted {
            return Err("workspace.read is not granted".to_string());
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
        if self.workspace_permission != ContextPermissionState::Granted {
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
        Ok(true)
    }

    fn read_clipboard(&mut self) -> Result<String, String> {
        Ok(String::new())
    }

    fn get_icon_svg(&mut self, name: String) -> Option<String> {
        match name.as_str() {
            "check" => Some("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"20 6 9 17 4 12\"/></svg>".to_string()),
            "trash" => Some("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/></svg>".to_string()),
            "plus" => Some("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"12\" y1=\"5\" x2=\"12\" y2=\"19\"/><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/></svg>".to_string()),
            "clipboard" => Some("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"/><rect x=\"8\" y=\"2\" width=\"8\" height=\"4\" rx=\"1\" ry=\"1\"/></svg>".to_string()),
            "calendar" => Some("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"18\" rx=\"2\" ry=\"2\"/><line x1=\"16\" y1=\"2\" x2=\"16\" y2=\"6\"/><line x1=\"8\" y1=\"2\" x2=\"8\" y2=\"6\"/><line x1=\"3\" y1=\"10\" x2=\"21\" y2=\"10\"/></svg>".to_string()),
            "code" => Some("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"16 18 22 12 16 6\"/><polyline points=\"8 6 2 12 8 18\"/></svg>".to_string()),
            _ => None,
        }
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

    fn insert_editor_text(&mut self, _text: String) -> Result<bool, String> {
        if self.editor_permission != ContextPermissionState::Granted {
            return Err("缺少 editor.current.read 权限".to_string());
        }
        Ok(true)
    }

    fn reveal_editor_line(&mut self, _line: u32) -> Result<bool, String> {
        if self.editor_permission != ContextPermissionState::Granted {
            return Err("缺少 editor.current.read 权限".to_string());
        }
        Ok(true)
    }

    fn get_sdk_version(&mut self) -> u32 {
        1
    }

    fn contribute_fliuno_items(
        &mut self,
        items: Vec<aurona::extensions::context::FliunoItem>,
    ) -> Result<bool, String> {
        if self.fliuno_permission != ContextPermissionState::Granted {
            return Err("缺少 fliuno.search 权限".to_string());
        }
        eprintln!(
            "[aurona-fliuno] 扩展 {} 贡献了 {} 个搜索项",
            self.extension_id,
            items.len()
        );
        Ok(true)
    }

    fn storage_get(&mut self, key: String) -> Result<Option<String>, String> {
        // 沙箱键值存储：每个扩展按 id 分离
        let storage_dir = std::env::temp_dir()
            .join("aurona-extensions-storage")
            .join(&self.extension_id);
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
        let storage_dir = std::env::temp_dir()
            .join("aurona-extensions-storage")
            .join(&self.extension_id);
        std::fs::create_dir_all(&storage_dir).map_err(|e| format!("创建存储目录失败: {e}"))?;
        let file_path = storage_dir.join(format!("{key}.json"));
        std::fs::write(&file_path, value).map_err(|e| format!("写入存储项失败: {e}"))?;
        Ok(true)
    }

    fn storage_delete(&mut self, key: String) -> Result<bool, String> {
        let storage_dir = std::env::temp_dir()
            .join("aurona-extensions-storage")
            .join(&self.extension_id);
        let file_path = storage_dir.join(format!("{key}.json"));
        if file_path.exists() {
            let _ = std::fs::remove_file(file_path);
        }
        Ok(true)
    }

    fn storage_list_keys(&mut self) -> Result<Vec<String>, String> {
        let storage_dir = std::env::temp_dir()
            .join("aurona-extensions-storage")
            .join(&self.extension_id);
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

    pub fn render(
        &self,
        mut context: ExtensionContext,
        markdown: String,
    ) -> Result<RenderOutput, String> {
        context.limits = StoreLimitsBuilder::new()
            .memory_size(self.limits.memory_bytes)
            .table_elements(1024)
            .instances(16)
            .memories(16)
            .build();

        let mut store = Store::new(&self.engine, context);
        store.limiter(|state| &mut state.limits);
        store
            .set_fuel(10_000_000)
            .map_err(|error| format!("设置实例化燃料失败: {error}"))?;

        let instance = AuronaExtension::instantiate(&mut store, &self.component, &self.linker)
            .map_err(|error| format!("实例化扩展失败: {error:#}"))?;
        store
            .set_fuel(self.limits.fuel)
            .map_err(|error| format!("设置执行燃料失败: {error}"))?;
        let input = RenderInput { markdown };
        let output = instance
            .aurona_extensions_render()
            .call_render(&mut store, &input)
            .map_err(|error| format!("扩展渲染调用失败: {error:#}"))?
            .map_err(|error| format!("扩展渲染返回错误: {error}"))?;

        Ok(output)
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

    fn component_bytes() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../MarketplacePackages/auronalabs.markdown.aurx"
        );
        let bytes = std::fs::read(path).expect("committed AURX missing");
        crate::extensions::aurx::open_package(&bytes)
            .expect("committed AURX must be valid")
            .wasm
            .clone()
    }

    #[test]
    fn loads_and_renders_markdown() {
        let runtime =
            ExtensionRuntime::new(&component_bytes(), ExtensionLimits::default()).unwrap();
        let output = runtime
            .render(test_context(None), "# Hello".to_string())
            .unwrap();
        assert!(output.html.contains("<h1>Hello</h1>"), "{}", output.html);
        assert!(output.diagnostics.is_empty());
    }

    #[test]
    fn renders_table_and_strikethrough() {
        let runtime =
            ExtensionRuntime::new(&component_bytes(), ExtensionLimits::default()).unwrap();
        let markdown = "| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~";
        let output = runtime
            .render(test_context(None), markdown.to_string())
            .unwrap();
        assert!(output.html.contains("<table>"), "{}", output.html);
        assert!(output.html.contains("<del>gone</del>"), "{}", output.html);
    }

    #[test]
    fn sanitizes_malicious_html() {
        let runtime =
            ExtensionRuntime::new(&component_bytes(), ExtensionLimits::default()).unwrap();
        let markdown = "<script>alert(1)</script>\n\n[click](javascript:alert(1))";
        let output = runtime
            .render(test_context(None), markdown.to_string())
            .unwrap();
        assert!(!output.html.contains("<script"), "{}", output.html);
        assert!(!output.html.contains("javascript:"), "{}", output.html);
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
        context.editor_permission = ContextPermissionState::Denied;
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
        context.editor_permission = ContextPermissionState::Granted;
        let snapshot = context.get_editor_snapshot();
        assert_eq!(snapshot.content.as_deref(), Some("# visible"));
        assert_eq!(snapshot.version, 3);
    }

    #[test]
    fn rejects_workspace_escape() {
        let temp =
            std::env::temp_dir().join(format!("aurona-ext-workspace-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join("file.txt"), b"ok").unwrap();
        let mut host = test_context(Some(temp.clone()));
        host.workspace_permission = ContextPermissionState::Granted;
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
        host.workspace_permission = ContextPermissionState::Granted;

        // 正常写入根目录下与子目录下文件
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
        assert!(host
            .write_workspace_file("C:\\Windows\\system.txt".to_string(), "bad".to_string())
            .is_err());

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
        host.workspace_permission = ContextPermissionState::Denied;

        let info = host.get_workspace_info();
        assert!(!info.has_workspace);
        assert_eq!(info.name, None);
        assert!(host.list_workspace_files(".".to_string(), 10).is_err());

        host.workspace_permission = ContextPermissionState::Granted;
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

    #[test]
    fn fuel_exhaustion_is_isolated_error() {
        let runtime = ExtensionRuntime::new(
            &component_bytes(),
            ExtensionLimits {
                memory_bytes: 64 * 1024 * 1024,
                fuel: 1,
            },
        )
        .unwrap();
        let result = runtime.render(test_context(None), "# Hello".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn memory_limit_is_enforced() {
        let runtime = ExtensionRuntime::new(
            &component_bytes(),
            ExtensionLimits {
                memory_bytes: 1,
                fuel: 10_000_000,
            },
        )
        .unwrap();
        let result = runtime.render(test_context(None), "# Hello".to_string());
        assert!(result.is_err());
    }
}
