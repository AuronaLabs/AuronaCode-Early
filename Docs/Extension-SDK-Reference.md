# Aurona SDK 参考手册

本文档为 Aurona Code 扩展开发者提供统一面向对象（OOP）**Aurona SDK** 与底层 WIT 契约的完整 API 参考。

---

## 1. 统一面向对象 SDK 门面速查

在 Rust 扩展中，通过 `Aurona` 顶级静态单例访问各大宿主能力服务：

```rust
use aurona_extension_sdk::Aurona; // 或直接使用插件内部的 pub mod sdk
```

### 1.1 环境与配置 (`Aurona::config()`)
```rust
let config = Aurona::config();

// 字段说明
config.locale;        // 当前语言，如 "zh-CN", "zh-Hant", "en"
config.color_scheme;  // 当前主题配色，"dark" | "light"
config.app_version;   // Aurona Code 版本号，如 "0.3.15"
config.platform;      // 宿主平台，如 "windows", "macos", "linux"
```

### 1.2 工作区安全文件系统 (`Aurona::workspace()`)
所有文件操作均受宿主沙箱安全隔离保护，仅允许在已打开的工作区内操作：

```rust
let ws = Aurona::workspace();

// 获取工作区元数据
let info = ws.info();

// 读取工作区文件
let content: Result<String, String> = ws.read_file(".aurona/planner.json");

// 安全写入工作区文件（单次上限 10MiB，自动创建缺失目录，防逃逸）
let success: Result<bool, String> = ws.write_file(".aurona/data.json", "{\"key\":\"val\"}");

// 列出工作区目录项（受最大条目数限制）
let files: Result<Vec<FileEntry>, String> = ws.list_files("src", 100);

// 监听指定工作区路径变动
let watch_id: Result<u64, String> = ws.watch("src");
```

### 1.3 活跃编辑器服务 (`Aurona::editor()`)
```rust
let editor = Aurona::editor();

// 获取当前活跃文档快照（需申请 editor.current.read 权限）
let snapshot = editor.snapshot();

// 获取当前选区范围
let selection = editor.selection();

// 在当前光标处插入文本
let ok = editor.insert_text("console.log('Hello');");

// 视口滚动并聚焦到指定行
let ok = editor.reveal_line(42);
```

### 1.4 窗口与通知服务 (`Aurona::window()`)
```rust
let win = Aurona::window();

// 弹出信息/警告/错误通知 Toast
win.show_info("任务已成功保存");
win.show_warning("检测到部分配置项缺失，已采用默认值");
win.show_error("编译失败，请检查语法错误");

// 设置底部状态栏临时提示消息（带超时毫秒数）
win.set_status_bar("正在同步扩展状态...", 3000);
```

### 1.5 命令调度服务 (`Aurona::commands()`)
```rust
let cmds = Aurona::commands();

// 执行内置或已注册的命令
let result = cmds.execute("editor.action.formatDocument", &[]);
```

### 1.6 剪贴板服务 (`Aurona::clipboard()`)
```rust
let clip = Aurona::clipboard();

// 读取剪贴板内容
let text = clip.read();

// 写入内容到剪贴板
let ok = clip.write("https://github.com/AuronaLabs");
```

### 1.7 矢量图标库 (`Aurona::icons()`)
获取内置的官方 Tabler 矢量 SVG 图标：

```rust
let icons = Aurona::icons();

let check_svg = icons.get("check");       // 对勾图标
let clipboard_svg = icons.get("clipboard");// 剪贴板图标
let trash_svg = icons.get("trash");       // 垃圾桶图标
let plus_svg = icons.get("plus");         // 加号图标
let code_svg = icons.get("code");         // 代码/终端图标
let calendar_svg = icons.get("calendar"); // 日历图标
```

### 1.8 诊断日志服务 (`Aurona::logger()`)
```rust
let logger = Aurona::logger();
logger.info("插件已加载并就绪");
logger.warn("检测到性能警告");
logger.error("解析文件失败");
```

---

## 2. Aurona Marketplace 市场清单规范 (`manifest.json`)

每个 `.aurx` 插件必须在根目录包含 `manifest.json`，支持完整的市场分类与索引元数据：

```json
{
  "packageVersion": 1,
  "id": "aurona.sample",
  "name": "Sample Extension",
  "displayName": {
    "zh-CN": "示例插件",
    "zh-Hant": "範例擴充",
    "en": "Sample Extension"
  },
  "publisher": "aurona",
  "version": "0.1.0",
  "engine": { "auronaCode": ">=0.3.15" },
  "runtime": { "component": "extension.wasm" },
  "sidebar": {
    "title": "Sample",
    "icon": "assets/icon.svg"
  },
  "view": { "entry": "ui/index.html" },
  "marketplace": {
    "categories": ["Productivity", "Developer Tools"],
    "tags": ["sample", "wasm", "sdk"],
    "author": "Aurona Code Team",
    "homepage": "https://github.com/AuronaLabs/AuronaCode-Early",
    "repository": "https://github.com/AuronaLabs/AuronaCode-Early",
    "license": "MIT"
  }
}
```

---

## 3. UI 模板与主题 CSS 变量规范

扩展视图运行在沙箱 `iframe` 中，可直接通过以下 CSS 变量支持深浅色模式：

```css
:root, :root[data-theme="light"] {
  --bg: #ffffff;
  --fg: #0f172a;
  --muted: #64748b;
  --card-bg: rgba(0, 0, 0, 0.03);
  --card-border: rgba(0, 0, 0, 0.07);
  --accent: #0284c7;
  --radius: 12px;
}

:root[data-theme="dark"] {
  --bg: #0d1117;
  --fg: #e6edf3;
  --muted: #8b949e;
  --card-bg: rgba(255, 255, 255, 0.04);
  --card-border: rgba(255, 255, 255, 0.08);
  --accent: #38bdf8;
  --radius: 12px;
}
```

---

## 4. 官方原生声明式组件协议 (Declarative Component Schema)

插件可以直接输出声明式 JSON，由 Aurona 宿主使用原生 React 拟物组件树驱动渲染，零额外 CSS 体积：

```json
{
  "mode": "declarative",
  "title": "配置中心",
  "components": [
    {
      "type": "card",
      "id": "card_main",
      "title": "运行环境",
      "children": [
        {
          "type": "select",
          "id": "channelSelect",
          "label": "分发渠道",
          "value": "pioneer",
          "options": [
            { "label": "Stable 正式版", "value": "stable" },
            { "label": "Pioneer 先锋计划", "value": "pioneer" }
          ]
        },
        {
          "type": "switch",
          "id": "syncSwitch",
          "label": "自动持久化",
          "checked": true
        },
        {
          "type": "button",
          "id": "btnSave",
          "label": "保存并应用",
          "variant": "primary",
          "action": "config:apply"
        }
      ]
    }
  ]
}
```

