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
    PermissionState as ContextPermissionState,
};
pub use exports::aurona::extensions::render::{RenderInput, RenderOutput};

const DEFAULT_MEMORY_BYTES: usize = 64 * 1024 * 1024;
const DEFAULT_FUEL: u64 = 10_000_000;
const MAX_WORKSPACE_READ_BYTES: u64 = 4 * 1024 * 1024;

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
    pub workspace_root: Option<std::path::PathBuf>,
    pub environment: ContextEnvironment,
    pub editor_snapshot: Option<ContextEditorSnapshot>,
    pub editor_permission: ContextPermissionState,
    pub workspace_permission: ContextPermissionState,
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
            workspace_root,
            environment,
            editor_snapshot: None,
            editor_permission: ContextPermissionState::Unknown,
            workspace_permission: ContextPermissionState::Unknown,
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
            locale: self.environment.locale.clone(),
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
}

pub struct ExtensionRuntime {
    engine: Engine,
    component: wasmtime::component::Component,
    limits: ExtensionLimits,
}

impl ExtensionRuntime {
    pub fn new(component_bytes: &[u8], limits: ExtensionLimits) -> Result<Self, String> {
        let mut config = Config::new();
        config.consume_fuel(true);
        let engine =
            Engine::new(&config).map_err(|error| format!("Wasmtime 引擎初始化失败: {error}"))?;
        let component = wasmtime::component::Component::new(&engine, component_bytes)
            .map_err(|error| format!("WASM 组件无效: {error}"))?;
        Ok(Self {
            engine,
            component,
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

        let mut linker = Linker::new(&self.engine);
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker)
            .map_err(|error| format!("链接扩展 WASI 兜底失败: {error}"))?;
        AuronaExtension::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
            .map_err(|error| format!("链接扩展宿主上下文失败: {error}"))?;

        let instance = AuronaExtension::instantiate(&mut store, &self.component, &linker)
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
            locale: "zh-CN".to_string(),
        }
    }

    fn test_context(workspace_root: Option<PathBuf>) -> ExtensionContext {
        ExtensionContext::new(workspace_root, test_environment())
    }

    fn component_bytes() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/resources/extensions/aurona.markdown.aurx"
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
