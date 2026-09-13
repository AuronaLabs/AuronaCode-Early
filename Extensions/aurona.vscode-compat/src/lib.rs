use boa_engine::{
    object::builtins::{JsArray, JsPromise},
    object::FunctionObjectBuilder,
    property::Attribute,
    Context, JsArgs, JsError, JsResult, JsValue, NativeFunction, Source,
};

wit_bindgen::generate!({
    path: "../wit/world.wit",
    world: "aurona-extension",
});

use exports::aurona::extensions::render::{Guest, RenderInput, RenderOutput};

/// 官方标准面向对象 Aurona SDK (v1)
pub mod sdk {
    use super::aurona::extensions::context::{
        self, EditorSnapshot, Environment, FileEntry, SelectionRange, WorkspaceInfo,
    };

    /// Aurona 顶级静态单例门面
    pub struct Aurona;

    impl Aurona {
        /// 返回当前 SDK 契约版本号 (固定为 1)
        #[inline]
        pub fn version() -> u32 {
            context::get_sdk_version()
        }

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
        pub fn storage() -> StorageService {
            StorageService
        }
    }

    /// 工作区服务
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

    /// 编辑器服务
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

        #[inline]
        pub fn selection_text(&self) -> Option<String> {
            context::get_editor_selection_text()
        }

        #[inline]
        pub fn insert_text(&self, text: &str) -> Result<bool, String> {
            context::insert_editor_text(text)
        }

        #[inline]
        pub fn reveal_line(&self, line: u32) -> Result<bool, String> {
            context::reveal_editor_line(line)
        }
    }

    /// 窗口与通知服务
    pub struct WindowService;

    impl WindowService {
        #[inline]
        pub fn show_info(&self, message: &str) -> Result<bool, String> {
            context::show_notification("info", message)
        }

        #[inline]
        pub fn show_warning(&self, message: &str) -> Result<bool, String> {
            context::show_notification("warn", message)
        }

        #[inline]
        pub fn show_error(&self, message: &str) -> Result<bool, String> {
            context::show_notification("error", message)
        }

        #[inline]
        pub fn show_success(&self, message: &str) -> Result<bool, String> {
            context::show_notification("success", message)
        }

        #[inline]
        pub fn set_status_bar(&self, message: &str, timeout_ms: u32) -> Result<bool, String> {
            context::set_status_message(message, timeout_ms)
        }

        #[inline]
        pub(crate) fn show_by_level(&self, level: &str, message: &str) {
            let result = match level {
                "warn" => self.show_warning(message),
                "error" => self.show_error(message),
                _ => self.show_info(message),
            };
            let _ = result;
        }
    }

    /// 命令调度服务
    pub struct CommandService;

    impl CommandService {
        #[inline]
        pub fn execute(&self, command_id: &str, args: &[String]) -> Result<String, String> {
            context::execute_command(command_id, args)
        }
    }

    /// 剪贴板服务
    pub struct ClipboardService;

    impl ClipboardService {
        #[inline]
        pub fn read(&self) -> Result<String, String> {
            context::read_clipboard()
        }

        #[inline]
        pub fn write(&self, text: &str) -> Result<bool, String> {
            context::write_clipboard(text)
        }
    }

    /// 诊断日志服务
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

    /// 独立沙箱持久化存储服务
    pub struct StorageService;

    impl StorageService {
        #[inline]
        pub fn get(&self, key: &str) -> Result<Option<String>, String> {
            context::storage_get(key)
        }

        #[inline]
        pub fn set(&self, key: &str, value: &str) -> Result<bool, String> {
            context::storage_set(key, value)
        }
    }
}

pub use sdk::Aurona;

fn js_error(error: JsError) -> String {
    error.to_string()
}

use boa_engine::{JsObject, JsString};

fn new_object(context: &mut Context) -> JsResult<JsObject> {
    Ok(JsObject::with_object_proto(context.intrinsics()))
}

fn set_value(
    target: &JsObject,
    key: &str,
    value: impl Into<JsValue>,
    context: &mut Context,
) -> JsResult<()> {
    target
        .set(JsString::from(key), value.into(), false, context)
        .map(|_| ())
}

fn set_fn(target: &JsObject, key: &str, f: NativeFunction, context: &mut Context) -> JsResult<()> {
    let func = FunctionObjectBuilder::new(context.realm(), f)
        .name(key)
        .build();
    set_value(target, key, func, context)
}

/// CJS 环境垫片：console / module / exports / require / 命令注册全部以 JS 定义，
/// 状态保存在 GC 可达的全局对象图（__auronaLogs、vscode.commands.__registry），
/// 因此所有原生闭包都无需捕获任何 Rust 状态（避免 boa GC 追踪 UB）。
const SHIM_JS: &str = r#"
    globalThis.__auronaLogs = [];
    globalThis.console = {
        log: (...args) => { __auronaLogs.push('[log] ' + args.map(String).join(' ')); },
        info: (...args) => { __auronaLogs.push('[info] ' + args.map(String).join(' ')); },
        warn: (...args) => { __auronaLogs.push('[warn] ' + args.map(String).join(' ')); },
        error: (...args) => { __auronaLogs.push('[error] ' + args.map(String).join(' ')); },
    };
    globalThis.module = { exports: {} };
    globalThis.exports = module.exports;
    globalThis.require = (name) => {
        if (name === 'vscode') { return vscode; }
        throw new TypeError('兼容沙箱仅支持 require(\'vscode\')，收到: ' + name);
    };
    vscode.commands.registerCommand = (id, handler) => {
        if (typeof handler !== 'function') {
            throw new TypeError('registerCommand(id, handler) 需要 handler 为函数');
        }
        vscode.commands.__registry.push([id, handler]);
        return undefined;
    };
    vscode.commands.executeCommand = (id, ...args) => {
        for (const entry of vscode.commands.__registry) {
            if (entry[0] === id) { return entry[1](...args); }
        }
        throw new TypeError('命令未注册: ' + id);
    };
"#;

/// 把 `require("vscode")`、`console`、`module/exports` 注入 boa 全局。
fn install_shims(context: &mut Context) -> JsResult<()> {
    let vscode = build_vscode_module(context)?;
    context.register_global_property(JsString::from("vscode"), vscode, Attribute::all())?;
    context.eval(Source::from_bytes(SHIM_JS.as_bytes()))?;
    Ok(())
}

/// 构建兼容层支持的 vscode.* API 表面（规划 §5.4 执行模型）。
/// 所有原生函数均为零捕获（Copy）闭包。
fn build_vscode_module(context: &mut Context) -> JsResult<JsObject> {
    let vscode = new_object(context)?;

    // --- vscode.commands（registerCommand/executeCommand 由 SHIM_JS 以 JS 定义）---
    let commands_ns = new_object(context)?;
    let registry = JsArray::new(context);
    set_value(&commands_ns, "__registry", registry, context)?;
    set_value(&vscode, "commands", commands_ns, context)?;

    // --- vscode.window ---
    let window_ns = new_object(context)?;
    for (key, level) in [
        ("showInformationMessage", "info"),
        ("showWarningMessage", "warn"),
        ("showErrorMessage", "error"),
    ] {
        set_fn(
            &window_ns,
            key,
            NativeFunction::from_copy_closure(move |_this, args, ctx| {
                let message = args
                    .get_or_undefined(0)
                    .to_string(ctx)?
                    .to_std_string_escaped();
                Aurona::window().show_by_level(level, &message);
                Ok(JsValue::undefined())
            }),
            context,
        )?;
    }
    {
        set_fn(
            &window_ns,
            "setStatusBarMessage",
            NativeFunction::from_copy_closure(move |_this, args, ctx| {
                let message = args
                    .get_or_undefined(0)
                    .to_string(ctx)?
                    .to_std_string_escaped();
                let timeout = args
                    .get_or_undefined(1)
                    .to_number(ctx)
                    .unwrap_or(4000.0) as u32;
                let _ = Aurona::window().set_status_bar(&message, timeout.max(500));
                Ok(JsValue::undefined())
            }),
            context,
        )?;
    }
    set_value(&vscode, "window", window_ns, context)?;

    // --- vscode.Uri ---
    let uri_ns = new_object(context)?;
    set_fn(
        &uri_ns,
        "file",
        NativeFunction::from_copy_closure(move |_this, args, ctx| {
            let path = args
                .get_or_undefined(0)
                .to_string(ctx)?
                .to_std_string_escaped();
            let uri = new_object(ctx)?;
            set_value(&uri, "scheme", JsString::from("file"), ctx)?;
            set_value(&uri, "fsPath", JsString::from(path.clone()), ctx)?;
            set_value(&uri, "path", JsString::from(path), ctx)?;
            Ok(uri.into())
        }),
        context,
    )?;
    set_value(&vscode, "Uri", uri_ns, context)?;

    // --- vscode.workspace ---
    let workspace_ns = new_object(context)?;
    let fs_ns = new_object(context)?;
    set_fn(
        &fs_ns,
        "readFile",
        NativeFunction::from_copy_closure(move |_this, args, ctx| {
            let uri = args.get_or_undefined(0);
            let path = match uri.as_object() {
                Some(obj) => {
                    let fs_path = obj.get(JsString::from("fsPath"), ctx)?;
                    fs_path.to_string(ctx)?.to_std_string_escaped()
                }
                None => uri.to_string(ctx)?.to_std_string_escaped(),
            };
            let promise = JsPromise::new(
                move |resolvers, ctx| match Aurona::workspace().read_file(&path) {
                    Ok(content) => resolvers.resolve.call(
                        &JsValue::undefined(),
                        &[JsValue::from(JsString::from(content))],
                        ctx,
                    ),
                    Err(error) => resolvers.reject.call(
                        &JsValue::undefined(),
                        &[JsValue::from(JsString::from(error))],
                        ctx,
                    ),
                },
                ctx,
            );
            Ok(promise.into())
        }),
        context,
    )?;
    set_value(&workspace_ns, "fs", fs_ns, context)?;
    // onDidChangeTextDocument：沙箱内暂无事件流，注册为 noop 兼容位。
    set_fn(
        &workspace_ns,
        "onDidChangeTextDocument",
        NativeFunction::from_copy_closure(|_this, _args, _ctx| Ok(JsValue::undefined())),
        context,
    )?;
    set_value(&vscode, "workspace", workspace_ns, context)?;

    // --- vscode.env.clipboard ---
    let env_ns = new_object(context)?;
    let clipboard_ns = new_object(context)?;
    set_fn(
        &clipboard_ns,
        "readText",
        NativeFunction::from_copy_closure(|_this, _args, _ctx| {
            Ok(JsValue::from(JsString::from(
                Aurona::clipboard().read().unwrap_or_default(),
            )))
        }),
        context,
    )?;
    set_fn(
        &clipboard_ns,
        "writeText",
        NativeFunction::from_copy_closure(move |_this, args, ctx| {
            let text = args
                .get_or_undefined(0)
                .to_string(ctx)?
                .to_std_string_escaped();
            let _ = Aurona::clipboard().write(&text);
            Ok(JsValue::undefined())
        }),
        context,
    )?;
    set_value(&env_ns, "clipboard", clipboard_ns, context)?;
    set_value(&env_ns, "appName", JsString::from("Aurona Code"), context)?;
    set_value(&vscode, "env", env_ns, context)?;

    Ok(vscode)
}

/// 构造传给 activate(context) 的 ExtensionContext 形状。
fn build_activation_context(context: &mut Context) -> JsResult<JsObject> {
    let ctx_obj = new_object(context)?;
    let subscriptions = JsArray::new(context);
    set_value(&ctx_obj, "subscriptions", subscriptions, context)?;
    set_value(&ctx_obj, "extensionPath", JsString::from(""), context)?;

    let state_obj = new_object(context)?;
    set_fn(
        &state_obj,
        "get",
        NativeFunction::from_copy_closure(move |_this, args, ctx| {
            let key = args
                .get_or_undefined(0)
                .to_string(ctx)?
                .to_std_string_escaped();
            match Aurona::storage().get(&key) {
                Ok(Some(value)) => Ok(JsValue::from(JsString::from(value))),
                _ => Ok(JsValue::undefined()),
            }
        }),
        context,
    )?;
    set_fn(
        &state_obj,
        "update",
        NativeFunction::from_copy_closure(move |_this, args, ctx| {
            let key = args
                .get_or_undefined(0)
                .to_string(ctx)?
                .to_std_string_escaped();
            let value = args
                .get_or_undefined(1)
                .to_string(ctx)?
                .to_std_string_escaped();
            let _ = Aurona::storage().set(&key, &value);
            Ok(JsValue::undefined())
        }),
        context,
    )?;
    set_value(&ctx_obj, "globalState", state_obj.clone(), context)?;
    set_value(&ctx_obj, "workspaceState", state_obj, context)?;
    Ok(ctx_obj)
}

/// 从 GC 可达的 vscode.commands.__registry 读取已注册命令 ID。
fn read_command_ids(context: &mut Context) -> Result<Vec<String>, String> {
    let vscode_value = context
        .global_object()
        .get(JsString::from("vscode"), context)
        .map_err(js_error)?;
    let Some(vscode_obj) = vscode_value.as_object() else {
        return Ok(Vec::new());
    };
    let commands_value = vscode_obj
        .get(JsString::from("commands"), context)
        .map_err(js_error)?;
    let Some(commands_obj) = commands_value.as_object() else {
        return Ok(Vec::new());
    };
    let registry_value = commands_obj
        .get(JsString::from("__registry"), context)
        .map_err(js_error)?;
    let Some(registry_obj) = registry_value.as_object() else {
        return Ok(Vec::new());
    };
    let length_value = registry_obj
        .get(JsString::from("length"), context)
        .map_err(js_error)?;
    let length = length_value.to_number(context).map_err(js_error)?;
    let mut ids = Vec::new();
    for index in 0..(length.max(0.0) as u64) {
        let Ok(entry_value) = registry_obj.get(index, context) else {
            continue;
        };
        let Some(entry_obj) = entry_value.as_object() else {
            continue;
        };
        let Ok(id_value) = entry_obj.get(0u32, context) else {
            continue;
        };
        let id = id_value
            .as_string()
            .map(|s| s.to_std_string_escaped())
            .unwrap_or_default();
        if !id.is_empty() {
            ids.push(id);
        }
    }
    Ok(ids)
}

/// 从 GC 可达的 __auronaLogs 读取 console 输出。
fn read_console_logs(context: &mut Context) -> Vec<String> {
    let Ok(value) = context
        .global_object()
        .get(JsString::from("__auronaLogs"), context)
    else {
        return Vec::new();
    };
    let Some(obj) = value.as_object() else {
        return Vec::new();
    };
    let Ok(length_value) = obj.get(JsString::from("length"), context) else {
        return Vec::new();
    };
    let Ok(length) = length_value.to_number(context) else {
        return Vec::new();
    };
    let mut logs = Vec::new();
    for index in 0..(length.max(0.0) as u64) {
        let Ok(item) = obj.get(index, context) else {
            continue;
        };
        if let Some(text) = item.as_string() {
            logs.push(text.to_std_string_escaped());
        }
    }
    logs
}

/// 执行一段 VSCode CJS 插件源码：eval → activate → 可选执行用户命令。
/// 全部发生在同一个 Context（跨 Context 调用 JS 函数属于未定义行为）。
/// 返回 (已注册命令 ID 列表, console 日志)。
fn execute_extension(
    source: &str,
    command_to_run: Option<&str>,
) -> Result<(Vec<String>, Vec<String>), String> {
    let mut context = Context::default();
    install_shims(&mut context).map_err(js_error)?;
    context
        .eval(Source::from_bytes(source.as_bytes()))
        .map_err(js_error)?;

    // 读取 module.exports.activate（兼容 module.exports = {...} 与 exports.activate = fn）。
    let module_value = context
        .global_object()
        .get(JsString::from("module"), &mut context)
        .map_err(js_error)?;
    let exports_value = module_value
        .as_object()
        .ok_or_else(|| "module 不是对象".to_string())?
        .get(JsString::from("exports"), &mut context)
        .map_err(js_error)?;
    let activate_fn = exports_value
        .as_object()
        .and_then(|exports| {
            exports
                .get(JsString::from("activate"), &mut context)
                .ok()
                .and_then(|value| value.as_function())
        })
        .ok_or_else(|| "扩展未导出 activate(context) 函数".to_string())?;

    let activation_ctx = build_activation_context(&mut context).map_err(js_error)?;
    activate_fn
        .call(&JsValue::undefined(), &[activation_ctx.into()], &mut context)
        .map_err(js_error)?;

    // 驱动 readFile 等 Promise 的 then 回调。
    context.run_jobs();

    let command_ids = read_command_ids(&mut context)?;

    if let Some(command_id) = command_to_run {
        if !command_ids.iter().any(|id| id == command_id) {
            return Err(format!("插件未注册命令: {command_id}"));
        }
        let call_source = format!(
            "vscode.commands.executeCommand(\"{}\");",
            json_escape(command_id)
        );
        context
            .eval(Source::from_bytes(call_source.as_bytes()))
            .map_err(js_error)?;
        context.run_jobs();
    }

    let logs = read_console_logs(&mut context);
    Ok((command_ids, logs))
}

fn json_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 2);
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// 生成声明式 UI（模式 A）根 JSON：命令卡 + 执行日志。
fn build_declarative_ui(
    title: &str,
    description: &str,
    commands: &[String],
    logs: &[String],
    executed: Option<&str>,
) -> String {
    let mut components = String::new();

    // 执行结果徽标
    if let Some(command_id) = executed {
        components.push_str(&format!(
            "{{\"type\":\"badge\",\"id\":\"exec_result\",\"text\":\"已执行: {}\",\"color\":\"green\"}},",
            json_escape(command_id)
        ));
    }

    // 命令卡
    if commands.is_empty() {
        components.push_str(
            "{\"type\":\"card\",\"id\":\"empty\",\"title\":\"未发现已注册命令\",\"children\":[{\"type\":\"text\",\"id\":\"hint\",\"content\":\"该插件在 activate 中没有调用 vscode.commands.registerCommand，或执行被沙箱终止。\",\"variant\":\"body\"}]}",
        );
    } else {
        let mut buttons = String::new();
        for id in commands {
            buttons.push_str(&format!(
                "{{\"type\":\"button\",\"id\":\"btn_{}\",\"label\":\"执行 {}\",\"variant\":\"primary\",\"action\":\"run:{}\"}},",
                json_escape(&id.replace(':', "_")),
                json_escape(id),
                json_escape(id)
            ));
        }
        buttons.pop();
        components.push_str(&format!(
            "{{\"type\":\"card\",\"id\":\"commands\",\"title\":\"已注册命令\",\"subtitle\":\"来自插件 activate(context) 的真实注册\",\"children\":[{buttons}]}}"
        ));
    }

    // 日志卡
    if !logs.is_empty() {
        let mut lines = String::new();
        for (index, log) in logs.iter().take(40).enumerate() {
            lines.push_str(&format!(
                "{{\"type\":\"text\",\"id\":\"log_{}\",\"content\":\"{}\",\"variant\":\"code\"}},",
                index,
                json_escape(log)
            ));
        }
        lines.pop();
        components.push_str(&format!(
            ",{{\"type\":\"card\",\"id\":\"logs\",\"title\":\"沙箱执行日志\",\"children\":[{lines}]}}"
        ));
    }

    format!(
        "{{\"mode\":\"declarative\",\"title\":\"{}\",\"description\":\"{}\",\"components\":[{components}]}}",
        json_escape(title),
        json_escape(description)
    )
}

/// 兼容层的执行入口（locale 由调用方注入，宿主机测试可传固定值）。
/// `action_id` 形如 `run:命令ID` 表示这是一次用户触发的命令执行。
fn compat_execute_with_locale(
    source: &str,
    action_id: &str,
    locale: &str,
) -> Result<RenderOutput, String> {
    let executed = action_id
        .strip_prefix("run:")
        .map(str::to_string)
        .filter(|id| !id.is_empty());

    let (command_ids, logs) = execute_extension(source, executed.as_deref())?;
    let mut sorted = command_ids;
    sorted.sort();
    sorted.dedup();

    let is_hant = locale.starts_with("zh-Hant");
    let is_zh = locale.starts_with("zh");
    let (title, description) = if is_hant {
        (
            "VSCode 外掛執行層",
            "由 Aurona 相容沙箱真實執行（Boa 引擎 · WASM 元件）",
        )
    } else if is_zh {
        (
            "VSCode 插件执行层",
            "由 Aurona 兼容沙箱真实执行（Boa 引擎 · WASM 组件）",
        )
    } else {
        (
            "VSCode Extension Runtime",
            "Really executed by the Aurona compat sandbox (Boa engine · WASM component)",
        )
    };

    Ok(RenderOutput {
        html: build_declarative_ui(
            title,
            description,
            &sorted,
            &logs,
            executed.as_deref(),
        ),
        diagnostics: Vec::new(),
    })
}

/// WIT 入口：locale 来自宿主环境注入。
fn compat_execute(source: &str, action_id: &str) -> Result<RenderOutput, String> {
    let locale = Aurona::config().locale;
    compat_execute_with_locale(source, action_id, &locale)
}

struct VsCodeCompatExtension;

impl Guest for VsCodeCompatExtension {
    fn render(input: RenderInput) -> Result<RenderOutput, String> {
        compat_execute(&input.markdown, "")
    }

    fn on_action(action_id: String, payload: String) -> Result<RenderOutput, String> {
        // payload 由 host 覆盖为主入口 JS 源码（§5.4：组件跨调用无状态）。
        compat_execute(&payload, &action_id)
    }
}

export!(VsCodeCompatExtension);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declarative_ui_lists_registered_commands() {
        let source = r#"
            const vscode = require('vscode');
            function activate(context) {
                vscode.commands.registerCommand('demo.hello', () => {
                    vscode.window.showInformationMessage('hello');
                });
            }
            module.exports = { activate };
        "#;
        let output = compat_execute_with_locale(source, "", "zh-CN").expect("执行应成功");
        assert!(output.html.contains("demo.hello"));
        assert!(output.html.contains("\"mode\":\"declarative\""));
    }

    #[test]
    fn on_action_executes_command_and_logs() {
        let source = r#"
            const vscode = require('vscode');
            function activate(context) {
                vscode.commands.registerCommand('demo.hello', () => {
                    console.log('command ran');
                });
            }
            module.exports = { activate };
        "#;
        let output = compat_execute_with_locale(source, "run:demo.hello", "zh-CN")
            .expect("命令执行应成功");
        assert!(output.html.contains("已执行: demo.hello"));
        assert!(output.html.contains("command ran"));
    }

    #[test]
    fn missing_activate_is_reported() {
        let output = compat_execute_with_locale("const vscode = require('vscode');", "", "zh-CN");
        assert!(output.is_err());
    }

    #[test]
    fn json_escape_produces_valid_json_string() {
        let escaped = json_escape("a\"b\nc");
        let parsed: serde_json::Value =
            serde_json::from_str(&format!("\"{escaped}\"")).expect("应为合法 JSON 字符串");
        assert_eq!(parsed, "a\"b\nc");
    }
}
