use exports::aurona::extensions::render::{Guest, RenderInput, RenderOutput};

wit_bindgen::generate!({
    path: "../wit/world.wit",
    world: "aurona-extension",
});

/// Aurona 官方面向对象 SDK
pub mod sdk {
    use super::aurona::extensions::context::{
        self, EditorSnapshot, Environment, FileEntry, SelectionRange, WorkspaceInfo,
    };

    pub struct Aurona;

    impl Aurona {
        #[inline]
        pub fn config() -> Environment {
            context::get_environment()
        }

        #[inline]
        pub fn workspace() -> WorkspaceService {
            WorkspaceService
        }

        #[inline]
        pub fn editor() -> EditorService {
            EditorService
        }

        #[inline]
        pub fn window() -> WindowService {
            WindowService
        }

        #[inline]
        pub fn commands() -> CommandService {
            CommandService
        }

        #[inline]
        pub fn clipboard() -> ClipboardService {
            ClipboardService
        }

        #[inline]
        pub fn logger() -> LoggerService {
            LoggerService
        }

        #[inline]
        pub fn icons() -> IconService {
            IconService
        }
    }

    pub struct WorkspaceService;

    impl WorkspaceService {
        #[inline]
        pub fn info(&self) -> WorkspaceInfo {
            context::get_workspace_info()
        }

        #[inline]
        pub fn read_file(&self, path: &str) -> Result<String, String> {
            context::read_workspace_file(path)
        }

        #[inline]
        pub fn write_file(&self, path: &str, content: &str) -> Result<bool, String> {
            context::write_workspace_file(path, content)
        }

        #[inline]
        pub fn list_files(&self, directory: &str, max_count: u32) -> Result<Vec<FileEntry>, String> {
            context::list_workspace_files(directory, max_count)
        }
    }

    pub struct EditorService;

    impl EditorService {
        #[inline]
        pub fn snapshot(&self) -> EditorSnapshot {
            context::get_editor_snapshot()
        }

        #[inline]
        pub fn selection(&self) -> Option<SelectionRange> {
            context::get_editor_selection()
        }
    }

    pub struct WindowService;

    impl WindowService {
        #[inline]
        pub fn show_info(&self, message: &str) -> Result<bool, String> {
            context::show_notification("info", message)
        }
    }

    pub struct CommandService;

    impl CommandService {
        #[inline]
        pub fn execute(&self, command_id: &str, args: &[String]) -> Result<String, String> {
            context::execute_command(command_id, args)
        }
    }

    pub struct ClipboardService;

    impl ClipboardService {
        #[inline]
        pub fn write(&self, text: &str) -> Result<bool, String> {
            context::write_clipboard(text)
        }
    }

    pub struct LoggerService;

    impl LoggerService {
        #[inline]
        pub fn info(&self, message: &str) {
            context::log("info", message);
        }

        #[inline]
        pub fn error(&self, message: &str) {
            context::log("error", message);
        }
    }

    pub struct IconService;

    impl IconService {
        #[inline]
        pub fn get(&self, name: &str) -> Option<String> {
            context::get_icon_svg(name)
        }
    }
}

pub use sdk::Aurona;

struct PlannerExtension;

const PLANNER_STORAGE_PATH: &str = ".aurona/planner.json";

#[derive(Debug, Clone)]
pub struct TaskItem {
    pub id: String,
    pub title: String,
    pub category: String,
    pub priority: String, // "high" | "normal" | "low"
    pub completed: bool,
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn parse_tasks_from_json(json_str: &str) -> Vec<TaskItem> {
    let mut tasks = Vec::new();
    let text = json_str.trim();
    if !text.starts_with('[') && !text.starts_with('{') {
        return tasks;
    }

    let mut in_task = false;
    let mut current_block = String::new();
    let mut depth = 0;

    for ch in text.chars() {
        if ch == '{' {
            depth += 1;
            if depth == 1 || (depth == 2 && text.starts_with('{')) {
                in_task = true;
                current_block.clear();
            }
        }

        if in_task {
            current_block.push(ch);
        }

        if ch == '}' {
            depth -= 1;
            if in_task && (depth == 0 || (depth == 1 && text.starts_with('{'))) {
                in_task = false;
                if let Some(task) = parse_single_task(&current_block) {
                    tasks.push(task);
                }
            }
        }
    }

    tasks
}

fn parse_single_task(block: &str) -> Option<TaskItem> {
    let get_str_val = |key: &str| -> Option<String> {
        let pattern = format!("\"{}\"", key);
        let pos = block.find(&pattern)?;
        let rest = &block[pos + pattern.len()..];
        let colon = rest.find(':')?;
        let after_colon = rest[colon + 1..].trim();
        if after_colon.starts_with('"') {
            let end_quote = after_colon[1..].find('"')?;
            Some(after_colon[1..=end_quote].to_string())
        } else {
            None
        }
    };

    let get_bool_val = |key: &str| -> bool {
        let pattern = format!("\"{}\"", key);
        if let Some(pos) = block.find(&pattern) {
            let rest = &block[pos + pattern.len()..];
            if let Some(colon) = rest.find(':') {
                let after_colon = rest[colon + 1..].trim();
                return after_colon.starts_with("true");
            }
        }
        false
    };

    let title = get_str_val("title")?;
    let id = get_str_val("id").unwrap_or_else(|| format!("t_{}", title.len()));
    let category = get_str_val("category").unwrap_or_else(|| "开发".to_string());
    let priority = get_str_val("priority").unwrap_or_else(|| "normal".to_string());
    let completed = get_bool_val("completed");

    Some(TaskItem {
        id,
        title,
        category,
        priority,
        completed,
    })
}

fn serialize_tasks_to_json(tasks: &[TaskItem]) -> String {
    let mut out = String::from("[\n");
    for (i, t) in tasks.iter().enumerate() {
        out.push_str("  {\n");
        out.push_str(&format!("    \"id\": \"{}\",\n", t.id));
        out.push_str(&format!(
            "    \"title\": \"{}\",\n",
            t.title.replace('"', "\\\"")
        ));
        out.push_str(&format!("    \"category\": \"{}\",\n", t.category));
        out.push_str(&format!("    \"priority\": \"{}\",\n", t.priority));
        out.push_str(&format!("    \"completed\": {}\n", t.completed));
        if i + 1 < tasks.len() {
            out.push_str("  },\n");
        } else {
            out.push_str("  }\n");
        }
    }
    out.push(']');
    out
}

fn handle_planner_payload(input_data: &str) -> Vec<TaskItem> {
    let trimmed = input_data.trim();

    // 1. 如果包含全量 tasks 列表，直接持久化并返回
    if !trimmed.is_empty() && (trimmed.starts_with('[') || trimmed.starts_with('{')) {
        let parsed = parse_tasks_from_json(trimmed);
        if !parsed.is_empty() {
            let json = serialize_tasks_to_json(&parsed);
            let _ = Aurona::workspace().write_file(PLANNER_STORAGE_PATH, &json);
            return parsed;
        }
    }

    // 2. 从本地工作区存储加载
    if let Ok(content) = Aurona::workspace().read_file(PLANNER_STORAGE_PATH) {
        let from_file = parse_tasks_from_json(&content);
        if !from_file.is_empty() {
            return from_file;
        }
    }

    Vec::new()
}

fn render_planner_html(tasks: &[TaskItem], locale: &str) -> RenderOutput {
    let is_zh = locale.starts_with("zh");
    let is_hant = locale.starts_with("zh-Hant");

    let total = tasks.len();
    let completed = tasks.iter().filter(|t| t.completed).count();
    let pending = total.saturating_sub(completed);
    let progress_pct = if total > 0 {
        (completed * 100) / total
    } else {
        0
    };

    let title_text = if is_hant {
        "任務與測試看板"
    } else if is_zh {
        "任务与测试看板"
    } else {
        "Task & Test Board"
    };

    let total_label = if is_hant { "總項" } else if is_zh { "总项" } else { "Total" };
    let done_label = if is_hant { "已完成" } else if is_zh { "已完成" } else { "Done" };
    let pending_label = if is_hant { "進行中" } else if is_zh { "进行中" } else { "Pending" };

    let empty_title = if is_hant {
        "暫無任務計劃"
    } else if is_zh {
        "暂无任务计划"
    } else {
        "No Tasks Yet"
    };

    let empty_desc = if is_hant {
        "在上方快速輸入任務並點擊添加，進度將自動安全儲存於 <code>.aurona/planner.json</code>。"
    } else if is_zh {
        "在上方快速输入任务并点击添加，进度将自动安全保存于 <code>.aurona/planner.json</code>。"
    } else {
        "Quickly add tasks above. Progress is automatically saved to <code>.aurona/planner.json</code>."
    };

    let icon_clipboard = Aurona::icons().get("clipboard").unwrap_or_default();
    let icon_check = Aurona::icons().get("check").unwrap_or_default();

    let mut html = String::new();
    html.push_str("<div class=\"planner-container\">");

    // 看板统计指标
    html.push_str("<div class=\"planner-header\">");
    html.push_str("<div class=\"planner-header-row\">");
    html.push_str(&format!("<h2 class=\"planner-title\">{title_text}</h2>"));
    html.push_str(&format!(
        "<span class=\"progress-badge\">{completed}/{total} ({progress_pct}%)</span>"
    ));
    html.push_str("</div>");

    html.push_str("<div class=\"planner-stats-grid\">");
    html.push_str(&format!(
        "<div class=\"stat-box\"><span class=\"stat-num\">{}</span><span class=\"stat-label\">{}</span></div>",
        total, total_label
    ));
    html.push_str(&format!(
        "<div class=\"stat-box stat-done\"><span class=\"stat-num\">{}</span><span class=\"stat-label\">{}</span></div>",
        completed, done_label
    ));
    html.push_str(&format!(
        "<div class=\"stat-box stat-pending\"><span class=\"stat-num\">{}</span><span class=\"stat-label\">{}</span></div>",
        pending, pending_label
    ));
    html.push_str("</div>");

    // 进度条
    html.push_str("<div class=\"progress-wrapper\">");
    html.push_str("<div class=\"progress-track\">");
    html.push_str(&format!(
        "<div class=\"progress-fill\" style=\"width: {}%;\"></div>",
        progress_pct
    ));
    html.push_str("</div>");
    html.push_str("</div>");
    html.push_str("</div>"); // planner-header

    // 任务列表或居中空状态
    if total == 0 {
        html.push_str("<div class=\"planner-empty-wrapper\">");
        html.push_str("<div class=\"planner-empty\">");
        html.push_str(&format!("<div class=\"empty-icon-svg\">{icon_clipboard}</div>"));
        html.push_str(&format!("<div class=\"empty-title\">{empty_title}</div>"));
        html.push_str(&format!("<p class=\"empty-text\">{empty_desc}</p>"));
        html.push_str("</div>");
        html.push_str("</div>");
    } else {
        html.push_str("<div class=\"task-list\">");
        for task in tasks {
            let status_class = if task.completed {
                "task-item completed"
            } else {
                "task-item pending"
            };
            let check_rendered = if task.completed { icon_check.as_str() } else { "" };
            let title_escaped = html_escape(&task.title);
            let category_escaped = html_escape(&task.category);

            // 分类色彩胶囊
            let category_class = match task.category.as_str() {
                "测试" => "badge-test",
                "开发" => "badge-dev",
                "文档" => "badge-doc",
                "优化" => "badge-opt",
                "设计" => "badge-design",
                _ => "badge-default",
            };

            let priority_badge = match task.priority.as_str() {
                "high" => "<span class=\"badge priority-high\">高优</span>",
                "low" => "<span class=\"badge priority-low\">低优</span>",
                _ => "<span class=\"badge priority-normal\">普通</span>",
            };

            html.push_str(&format!(
                "<div class=\"{status_class}\" data-task-id=\"{}\"><div class=\"checkbox\">{check_rendered}</div><div class=\"task-content\"><div class=\"task-title\">{title_escaped}</div><div class=\"task-meta\"><span class=\"badge category-badge {category_class}\">{category_escaped}</span>{priority_badge}</div></div></div>",
                task.id
            ));
        }
        html.push_str("</div>");
    }

    html.push_str("</div>"); // planner-container

    RenderOutput {
        html,
        diagnostics: Vec::new(),
    }
}

impl Guest for PlannerExtension {
    fn render(input: RenderInput) -> Result<RenderOutput, String> {
        let config = Aurona::config();
        let tasks = handle_planner_payload(&input.markdown);
        Ok(render_planner_html(&tasks, &config.locale))
    }
}

export!(PlannerExtension);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_json_tasks() {
        let json = r#"[
            {"id": "1", "title": "测试计划A", "category": "测试", "priority": "high", "completed": false},
            {"id": "2", "title": "开发计划B", "category": "开发", "priority": "normal", "completed": true}
        ]"#;
        let tasks = parse_tasks_from_json(json);
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].title, "测试计划A");
        assert!(!tasks[0].completed);
        assert_eq!(tasks[1].title, "开发计划B");
        assert!(tasks[1].completed);
    }

    #[test]
    fn render_html_contains_empty_state_and_progress() {
        let tasks = vec![TaskItem {
            id: "1".to_string(),
            title: "核心任务".to_string(),
            category: "开发".to_string(),
            priority: "high".to_string(),
            completed: true,
        }];
        let output = render_planner_html(&tasks, "zh-CN");
        assert!(output.html.contains("planner-container"));
        assert!(output.html.contains("1/1"));
        assert!(output.html.contains("核心任务"));
    }
}
