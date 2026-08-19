# Aurona Code AURX 插件 SDK 开发参考手册

本文档为 **Aurona Code** 扩展开发者提供全面的 WebAssembly 插件 SDK 接口规范、数据结构、调用范例与最佳实践。

---

## 1. 架构总览

Aurona 扩展运行于高性能的 **WebAssembly Component Model** 沙箱中。SDK 采用面向对象、命名空间隔离的优雅门面模式（类似 iOS Swift Foundation / UIKit 设计），让插件代码具备极佳的自解释性与人体工程学体验。

```
┌─────────────────────────────────────────────────────────────┐
│                      Aurona Code Host                       │
│  (Tauri / Rust Core: Document, Workspace, Theme, Window)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ 双向 WIT 契约绑定 (world.wit)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Aurona Extension SDK                      │
│                                                             │
│   ├── Aurona::config()      -> 宿主环境与视觉配置           │
│   ├── Aurona::editor()      -> 活跃编辑器快照与选区         │
│   ├── Aurona::workspace()   -> 工作区元数据与受限只读访问   │
│   ├── Aurona::logger()      -> 结构化分级诊断日志           │
│   └── Aurona::permissions() -> 动态细粒度权限请求           │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. SDK 核心模块与 API

### 2.1 门面入口 (`Aurona`)

`Aurona` 是所有扩展能力的统一入口，提供静态工厂方法获取各子系统服务。

```rust
use aurona_sdk::Aurona;

let config = Aurona::config();
let editor = Aurona::editor();
let workspace = Aurona::workspace();
let logger = Aurona::logger();
```

---

### 2.2 宿主环境与视觉配置 (`Aurona::config()`)

获取当前宿主的主题、颜色、深浅色模式、字号、字重与平台信息。

#### 返回类型：`Environment`
| 字段 | 类型 | 说明 | 示例值 |
| --- | --- | --- | --- |
| `theme` | `String` | 宿主全局主题标识 | `"dark"`, `"light"` |
| `accent_color` | `String` | 宿主当前强调色主题 | `"aurora"`, `"coral"`, `"amber"`, `"jade"` |
| `color_scheme` | `String` | 深浅色模式 | `"dark"`, `"light"` |
| `locale` | `String` | 界面语言代码 | `"zh-CN"`, `"zh-Hant"`, `"en"` |
| `font_weight` | `String` | 全局字重模式 | `"normal"`, `"bold"` |
| `font_size` | `String` | 界面字号等级 | `"compact"`, `"default"`, `"comfortable"`, `"large"` |
| `app_version` | `String` | 宿主软件版本号 | `"0.3.13"` |
| `platform` | `String` | 操作系统内核标识 | `"windows"`, `"macos"`, `"linux"` |

#### 使用范例
```rust
let config = Aurona::config();

if config.color_scheme == "dark" {
    // 渲染暗色模式特有样式
}

if config.font_weight == "bold" {
    // 响应加粗排版
}

match config.locale.as_str() {
    "zh-CN" => println!("当前语言：简体中文"),
    "zh-Hant" => println!("目前語言：繁體中文"),
    _ => println!("Language: English"),
}
```

---

### 2.3 编辑器服务 (`Aurona::editor()`)

管理与获取当前活动文档状态。（需声明或申请 `editor.current.read` 权限）。

#### 方法列表
```rust
impl EditorService {
    /// 获取当前活动文档快照
    pub fn snapshot(&self) -> EditorSnapshot;

    /// 获取当前编辑器选区物理坐标范围
    pub fn selection(&self) -> Option<SelectionRange>;
}
```

#### 数据结构
- **`EditorSnapshot`**：
  - `path: Option<String>`：文档绝对路径；
  - `language: Option<String>`：语言 ID（如 `"markdown"`, `"typescript"`）；
  - `content: Option<String>`：文档全量文本内容（未授权时为 `None`）；
  - `version: u64`：文档 Revision 版本号。
- **`SelectionRange`**：
  - `start: TextPosition { line: u32, character: u32 }`
  - `end: TextPosition { line: u32, character: u32 }`

#### 使用范例
```rust
let editor = Aurona::editor();
let snapshot = editor.snapshot();

if let Some(content) = snapshot.content {
    println!("当前文件大小: {} 字符", content.len());
}

if let Some(sel) = editor.selection() {
    println!("选区范围: 行 {}~{}", sel.start.line, sel.end.line);
}
```

---

### 2.4 工作区服务 (`Aurona::workspace()`)

提供工作区元数据获取与受限只读文件访问。（需声明或申请 `workspace.read` 权限）。

#### 方法列表
```rust
impl WorkspaceService {
    /// 获取工作区基础元数据
    pub fn info(&self) -> WorkspaceInfo;

    /// 安全只读工作区相对路径文件
    pub fn read_file(&self, path: &str) -> Result<String, String>;

    /// 枚举工作区指定目录下的文件项
    pub fn list_files(&self, directory: &str, max_count: u32) -> Result<Vec<FileEntry>, String>;

    /// 监听工作区指定相对路径的文件或目录变动（由 Aurona 宿主统筹管理）
    pub fn watch_path(&self, path: &str) -> Result<u64, String>;

    /// 撤销工作区路径监听
    pub fn unwatch_path(&self, watch_id: u64) -> Result<bool, String>;
}
```

#### 数据结构
- **`WorkspaceInfo`**：
  - `has_workspace: bool`：当前是否已打开工作区；
  - `name: Option<String>`：工作区显示名称；
  - `root_name: Option<String>`：根目录名称。
- **`FileEntry`**：
  - `name: String`：文件名或目录名；
  - `is_directory: bool`：是否为目录；
  - `size_bytes: u64`：文件物理字节大小。

#### 使用范例
```rust
let ws = Aurona::workspace();
let info = ws.info();

if info.has_workspace {
    if let Ok(files) = ws.list_files("", 50) {
        for file in files {
            println!("- {} ({} bytes)", file.name, file.size_bytes);
        }
    }
}
```

---

### 2.5 日志服务 (`Aurona::logger()`)

输出结构化分级日志至宿主主控台与调试面板，不污染 stdout。

```rust
let logger = Aurona::logger();

logger.info("扩展初始化完成");
logger.warn("解析过程中遇到非标准语法块");
logger.error("数据加载失败");
```

---

### 2.6 权限申请服务 (`Aurona::permissions()`)

支持扩展动态检查并请求特定敏感权限。

```rust
use aurona_sdk::PermissionState;

let state = Aurona::permissions().request("workspace.read");
match state {
    PermissionState::Granted => println!("权限已授予"),
    PermissionState::Denied => println!("用户已拒绝该权限"),
    PermissionState::Unknown => println!("尚未确认权限"),
}
```

---

## 3. 完整插件开发范例

```rust
use aurona_sdk::Aurona;
use exports::aurona::extensions::render::{Guest, RenderInput, RenderOutput};

struct MyExtension;

impl Guest for MyExtension {
    fn render(input: RenderInput) -> Result<RenderOutput, String> {
        let config = Aurona::config();
        let logger = Aurona::logger();

        logger.info(&format!("开始渲染，宿主语言: {}", config.locale));

        // 业务逻辑处理 ...
        let html = format!("<div class='theme-{}'>{}</div>", config.theme, input.markdown);

        Ok(RenderOutput {
            html,
            diagnostics: vec![],
        })
    }
}

export!(MyExtension);
```

---

## 4. 插件自主多语言清单规范

Aurona 坚持**插件自包含多语言**原则，宿主核心语言包不侵入硬编码具体插件名称。插件在 `manifest.json` 中随包携带本地化字典：

```json
{
  "packageVersion": 1,
  "id": "aurona.markdown",
  "name": "Markdown Preview",
  "displayName": {
    "zh-CN": "Markdown 预览",
    "zh-Hant": "Markdown 預覽",
    "en": "Markdown Preview"
  },
  "sidebar": {
    "title": "Markdown",
    "displayTitle": {
      "zh-CN": "Markdown",
      "zh-Hant": "Markdown",
      "en": "Markdown"
    },
    "icon": "assets/icon.svg"
  }
}
```

---

## 5. 视图生命周期与 Keep-Alive 驻留

- **保活驻留机制**：扩展侧边栏进入 Keep-Alive 状态，用户在文件树、搜索与扩展面板之间切换时，扩展视图保持 DOM 与状态驻留，不再重新挂载与重新初始化，切换秒开；
- **即时响应直通通道**：当用户切换活动文档时，系统绕过防抖延迟，首屏即刻同步直通触发渲染。

---

## 6. 质量与安全限制

- **Fuel 指令燃油硬预算**：单次函数调用上限为 `10,000,000` 燃油；死循环或巨型计算会被安全沙箱拦截；
- **内存硬配额**：物理内存上限为 `64 MiB`；
- **严格无原生 Socket**：扩展严禁发起未受管的网络请求；
- **路径遍历防护**：工作区访问严格限制于已授权根目录之内，严禁 `../` 逃逸。
