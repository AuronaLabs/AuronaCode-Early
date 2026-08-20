# Aurona Code Extension SDK 参考手册

本文档为 Aurona Code 扩展开发者提供统一门面 `Aurona` SDK 与底层 WIT 契约的完整 API 参考。

---

## 1. 统一 SDK 门面速查

在 Rust 扩展中，建议通过 `Aurona` 门面访问宿主能力：

```rust
use aurona_extension_sdk::Aurona; // 或直接使用插件内部的 pub mod sdk
```

### 1.1 环境与宿主信息 (`Aurona::config()`)
```rust
let config = Aurona::config();

// 字段说明
config.locale;        // 当前语言，如 "zh-CN", "zh-Hant", "en"
config.color_scheme;  // 当前主题配色，"dark" | "light"
config.app_version;   // Aurona Code 版本号，如 "0.3.14"
```

### 1.2 工作区安全文件系统 (`Aurona::workspace()`)
所有文件操作均受宿主沙箱安全隔离保护，仅允许在已打开的工作区内操作。

```rust
let ws = Aurona::workspace();

// 读取工作区文件
let content: Result<String, String> = ws.read_file(".aurona/planner.json");

// 安全写入工作区文件（单次上限 10MiB，自动建缺失目录，防逃逸）
let success: Result<bool, String> = ws.write_file(".aurona/data.json", "{\"key\":\"val\"}");

// 列出工作区目录项
let files: Result<Vec<FileEntry>, String> = ws.list_files("src", 100);

// 监听指定工作区路径变动
let watch_id: Result<u64, String> = ws.watch_path("src");

// 撤销监听
let ok: Result<bool, String> = ws.unwatch_path(watch_id.unwrap());
```

### 1.3 矢量图标库 (`Aurona::icons()`)
获取内置的官方 Tabler 矢量 SVG 图标，无需在插件中使用纯字符或 emoji：

```rust
let icons = Aurona::icons();

let check_svg = icons.get("check");       // 对勾图标
let clipboard_svg = icons.get("clipboard");// 剪贴板图标
let trash_svg = icons.get("trash");       // 垃圾桶图标
let plus_svg = icons.get("plus");         // 加号图标
let code_svg = icons.get("code");         // 代码/终端图标
let calendar_svg = icons.get("calendar"); // 日历图标
```

### 1.4 日志服务 (`Aurona::logger()`)
```rust
let logger = Aurona::logger();
logger.info("插件已加载并就绪");
logger.warn("检测到部分配置项缺失，已采用默认值");
logger.error("解析文件失败");
```

---

## 2. UI 模板与主题 CSS 变量规范

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
