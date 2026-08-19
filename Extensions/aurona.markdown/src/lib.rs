use exports::aurona::extensions::render::{Guest, RenderInput, RenderOutput};

wit_bindgen::generate!({
    path: "../wit/world.wit",
    world: "aurona-extension",
});

/// ============================================================================
/// Aurona Extension SDK (iOS / Swift 风格统一面向对象 API)
/// ============================================================================
pub mod sdk {
    use super::aurona::extensions::context::{
        self, EditorSnapshot, Environment, FileEntry, PermissionState, SelectionRange,
        WorkspaceInfo,
    };

    /// Aurona 插件门面中心
    pub struct Aurona;

    impl Aurona {
        /// 获取宿主环境与视觉配置（语言、主题色、深浅色模式、字重、字号等）
        #[inline]
        pub fn config() -> Environment {
            context::get_environment()
        }

        /// 当前活跃编辑器服务
        #[inline]
        pub fn editor() -> EditorService {
            EditorService
        }

        /// 工作区文件系统服务
        #[inline]
        pub fn workspace() -> WorkspaceService {
            WorkspaceService
        }

        /// 宿主日志服务
        #[inline]
        pub fn logger() -> LoggerService {
            LoggerService
        }

        /// 权限管理服务
        #[inline]
        pub fn permissions() -> PermissionService {
            PermissionService
        }
    }

    /// 编辑器操作与快照服务
    pub struct EditorService;
    impl EditorService {
        /// 获取当前文档快照（需授权 editor.current.read）
        #[inline]
        pub fn snapshot(&self) -> EditorSnapshot {
            context::get_editor_snapshot()
        }

        /// 获取当前选区范围
        #[inline]
        pub fn selection(&self) -> Option<SelectionRange> {
            context::get_editor_selection()
        }
    }

    /// 工作区安全沙箱文件服务
    pub struct WorkspaceService;
    impl WorkspaceService {
        /// 获取当前工作区元数据
        #[inline]
        pub fn info(&self) -> WorkspaceInfo {
            context::get_workspace_info()
        }

        /// 安全只读工作区文件（需授权 workspace.read）
        #[inline]
        pub fn read_file(&self, path: &str) -> Result<String, String> {
            context::read_workspace_file(path)
        }

        /// 安全列出工作区目录（需授权 workspace.read）
        #[inline]
        pub fn list_files(&self, directory: &str, max_count: u32) -> Result<Vec<FileEntry>, String> {
            context::list_workspace_files(directory, max_count)
        }

        /// 监听工作区指定文件或目录变动（需授权 workspace.read）
        #[inline]
        pub fn watch_path(&self, path: &str) -> Result<u64, String> {
            context::watch_workspace_path(path)
        }

        /// 撤销工作区路径变动监听
        #[inline]
        pub fn unwatch_path(&self, watch_id: u64) -> Result<bool, String> {
            context::unwatch_workspace_path(watch_id)
        }
    }

    /// 结构化分级日志服务
    pub struct LoggerService;
    impl LoggerService {
        #[inline]
        pub fn info(&self, message: &str) {
            context::log("info", message);
        }

        #[inline]
        pub fn warn(&self, message: &str) {
            context::log("warn", message);
        }

        #[inline]
        pub fn error(&self, message: &str) {
            context::log("error", message);
        }
    }

    /// 细粒度权限请求服务
    pub struct PermissionService;
    impl PermissionService {
        #[inline]
        pub fn request(&self, permission: &str) -> PermissionState {
            context::request_permission(permission)
        }
    }
}

pub use sdk::Aurona;

struct MarkdownExtension;

fn localized_large_doc_warning(locale: &str) -> &'static str {
    if locale.starts_with("zh-Hant") {
        "文檔較大：即時預覽刷新率已降低"
    } else if locale.starts_with("zh") {
        "文档较大：实时预览刷新率已降低"
    } else {
        "Large document: preview refresh rate is reduced"
    }
}

fn render_markdown(markdown: &str, locale: &str) -> Result<RenderOutput, String> {
    let options =
        pulldown_cmark::Options::ENABLE_TABLES | pulldown_cmark::Options::ENABLE_STRIKETHROUGH;
    let parser = pulldown_cmark::Parser::new_ext(markdown, options);

    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, parser);

    let clean = ammonia::Builder::default().clean(&html).to_string();

    let mut diagnostics = Vec::new();
    if markdown.len() > 512 * 1024 {
        diagnostics.push(localized_large_doc_warning(locale).to_string());
    }

    Ok(RenderOutput {
        html: clean,
        diagnostics,
    })
}

impl Guest for MarkdownExtension {
    fn render(input: RenderInput) -> Result<RenderOutput, String> {
        let config = Aurona::config();
        render_markdown(&input.markdown, &config.locale)
    }
}

export!(MarkdownExtension);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_render_heading() {
        let output = render_markdown("# Hello", "zh-CN").unwrap();
        assert!(output.html.contains("<h1>Hello</h1>"), "{}", output.html);
    }

    #[test]
    fn native_render_table() {
        let output =
            render_markdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~", "zh-CN").unwrap();
        assert!(output.html.contains("<table>"), "{}", output.html);
        assert!(output.html.contains("<del>gone</del>"), "{}", output.html);
    }

    #[test]
    fn native_sanitize() {
        let output =
            render_markdown("<script>alert(1)</script>\n\n[click](javascript:alert(1))", "zh-CN")
                .unwrap();
        assert!(!output.html.contains("<script"), "{}", output.html);
        assert!(!output.html.contains("javascript:"), "{}", output.html);
    }
}
