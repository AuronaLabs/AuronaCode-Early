# Aurona Code AURX 扩展开发实战指南

本文档全面介绍 **Aurona Code** 的 WebAssembly (WASM) 扩展架构体系与 AURX 扩展包规范，并提供从零开发、测试与打包一个完整扩展的端到端实战教程。

---

## 目录

1. [架构全景与安全沙箱哲学](#1-架构全景与安全沙箱哲学)
2. [AURX 扩展包规范](#2-aurx-扩展包规范)
3. [WIT 契约与 Host API 详解](#3-wit-契约与-host-api-详解)
4. [从零开始开发一个扩展（实战）](#4-从零开始开发一个扩展实战)
5. [UI 视图、CSP 安全与渲染插槽](#5-ui-视图csp-安全与渲染插槽)
6. [权限系统与运行边界约束](#6-权限系统与运行边界约束)
7. [打包、构建与调试排错 FAQ](#7-打包构建与调试排错-faq)

---

## 1. 架构全景与安全沙箱哲学

Aurona Code 的扩展体系基于现代化 **WebAssembly Component Model** 与 **Wasmtime 47.x** 运行时设计，贯彻以下四大核心哲学：

```
┌─────────────────────────────────────────────────────────────┐
│                      Aurona Code Host                       │
│  (Tauri / Rust Core: Document, Workspace, Theme, Window)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ 双向结构化通信 (WIT Contract)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 WASM Component Sandbox                      │
│   • 物理内存硬限制: 64 MiB                                   │
│   • Fuel 双阶段指令预算: 10,000,000                         │
│   • 严格无本地文件系统逃逸 / 无网络 Socket                  │
└──────────────────────────────┬──────────────────────────────┘
                               │ 安全渲染 HTML 产物注入
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Sandboxed Iframe / Webview                    │
│   • Content-Security-Policy: default-src 'none'             │
│   • 禁止调用原生系统 API，禁止跨层访问主界面 DOM            │
└─────────────────────────────────────────────────────────────┘
```

1. **强沙箱隔离**：插件代码编译为 `wasm32-wasip2` Component 二进制，无法直接访问宿主操作系统文件系统或网络；
2. **轻量与可控**：采用单指令 Fuel（燃油）计量与物理内存硬上限（默认 64 MiB），杜绝任何恶意死循环或内存泄露影响主编辑器；
3. **分层 UI 隔离**：插件的前端界面运行于独立沙箱 WebView/iframe 中，严格受 CSP 约束，仅通过宿主结构化数据插槽完成视图渲染；
4. **按需懒加载**：应用启动时只解析 manifest 元数据，用户未打开扩展侧边栏前不消耗任何 WASM 实例化内存与 CPU。

---

## 2. AURX 扩展包规范

AURX 是 Aurona Code 的官方扩展分发归档格式（文件扩展名为 `.aurx`），其底层为基于标准 PKZip 规范构建的单文件包，内部组织结构如下：

```
my-extension.aurx
├── manifest.json       # 扩展核心元数据声明（必需）
├── extension.wasm      # WASM Component Model 编译产物（必需）
├── ui/
│   └── index.html      # 插件沙箱视图模板（必需）
└── assets/
    └── icon.svg        # 侧边栏图标矢量文件（必需）
```

### 2.1 manifest.json 字段定义

```json
{
  "packageVersion": 1,
  "id": "aurona.markdown",
  "name": "Markdown Preview",
  "publisher": "aurona",
  "version": "0.1.0",
  "engine": {
    "auronaCode": ">=0.3.13"
  },
  "runtime": {
    "component": "extension.wasm"
  },
  "sidebar": {
    "title": "Markdown",
    "icon": "assets/icon.svg"
  },
  "view": {
    "entry": "ui/index.html"
  }
}
```

- `id`：全局唯一扩展标识符，命名规范为 `<publisher>.<name>`；
- `engine.auronaCode`：要求宿主 Aurona Code 的最低版本兼容范围；
- `sidebar.icon`：建议使用 `stroke="currentColor"` 的 24x24 矢量 SVG 图标，以无缝适配宿主深浅色主题；
- `view.entry`：插件侧边栏主界面入口。

---

## 3. WIT 契约与 Host API 详解

宿主与扩展之间的所有能力交互均由 WIT (WebAssembly Interface Types) 严格声明（位于 `Extensions/wit/world.wit`）。

```wit
package aurona:extensions;

interface context {
  record environment {
    theme: string,
    locale: string,
    app-version: string,
    platform: string,
  }

  record text-position {
    line: u32,
    character: u32,
  }

  record selection-range {
    start: text-position,
    end: text-position,
  }

  record editor-snapshot {
    path: option<string>,
    language: option<string>,
    content: option<string>,
    version: u64,
  }

  record workspace-info {
    has-workspace: bool,
    name: option<string>,
    root-name: option<string>,
  }

  record file-entry {
    name: string,
    is-directory: bool,
    size-bytes: u64,
  }

  enum permission-state {
    unknown,
    granted,
    denied,
  }

  /// 获取宿主环境上下文（主题、语言、版本与平台）
  get-environment: func() -> environment;

  /// 获取当前活跃编辑器的快照（需 editor.current.read 权限）
  get-editor-snapshot: func() -> editor-snapshot;

  /// 获取当前编辑器的光标/选区（需 editor.current.read 权限）
  get-editor-selection: func() -> option<selection-range>;

  /// 获取工作区基本信息（需 workspace.read 权限）
  get-workspace-info: func() -> workspace-info;

  /// 检查或请求指定权限的状态
  request-permission: func(permission: string) -> permission-state;

  /// 安全读取当前工作区内的文本文件（相对路径，需 workspace.read 权限）
  read-workspace-file: func(path: string) -> result<string, string>;

  /// 安全遍历当前工作区指定目录下的文件项列表（需 workspace.read 权限）
  list-workspace-files: func(directory: string, max-count: u32) -> result<list<file-entry>, string>;

  /// 向宿主标准控制台输出结构化诊断日志
  log: func(level: string, message: string);
}

interface render {
  record render-input {
    markdown: string,
  }

  record render-output {
    html: string,
    diagnostics: list<string>,
  }

  render: func(input: render-input) -> result<render-output, string>;
}

world aurona-extension {
  import context;
  export render;
}
```

---

## 4. 从零开始开发一个扩展（实战）

以开发一个自定义 Markdown 增强预览插件为例：

### 步骤 1：初始化 Rust Guest 工程

在 `Extensions/` 目录下创建新工程：

```bash
cargo new --lib Extensions/my.extension
```

编辑 `Cargo.toml`：

```toml
[package]
name = "my_extension"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wit-bindgen = "0.36.0"
pulldown-cmark = { version = "0.12", default-features = false, features = ["html"] }
ammonia = "4.0"
```

### 步骤 2：编写核心逻辑 (`src/lib.rs`)

```rust
use exports::aurona::extensions::render::{Guest, RenderInput, RenderOutput};

// 自动根据 ../wit/world.wit 生成 Rust 强类型绑定
wit_bindgen::generate!({
    path: "../wit/world.wit",
    world: "aurona-extension",
});

struct MyExtension;

impl Guest for MyExtension {
    fn render(input: RenderInput) -> Result<RenderOutput, String> {
        // 1. 获取宿主环境上下文
        let env = aurona::extensions::context::get_environment();
        aurona::extensions::context::log("info", &format!("Rendering for locale: {}", env.locale));

        // 2. 解析 Markdown 并进行 HTML 消毒清洗
        let parser = pulldown_cmark::Parser::new(&input.markdown);
        let mut raw_html = String::new();
        pulldown_cmark::html::push_html(&mut raw_html, parser);
        let clean_html = ammonia::clean(&raw_html);

        Ok(RenderOutput {
            html: clean_html,
            diagnostics: vec![],
        })
    }
}

export!(MyExtension);
```

### 步骤 3：编译为 WASM Component

确保已安装 `wasm32-wasip2` 编译目标：

```bash
rustup target add wasm32-wasip2
cargo build --manifest-path Extensions/my.extension/Cargo.toml --target wasm32-wasip2 --release
```

---

## 5. UI 视图、CSP 安全与渲染插槽

扩展的 UI 文件位于 `ui/index.html`。它必须包含 `Content-Security-Policy` 与宿主约定的插槽注释：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Extension Preview</title>
  <style>
    :root {
      --bg: #ffffff;
      --fg: #1e293b;
    }
    :root[data-theme="dark"] {
      --bg: #13161d;
      --fg: #e2e8f0;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  </style>
</head>
<body>
  <!-- 必需：宿主将 WASM 渲染后的安全 HTML 注入此处 -->
  <article id="preview"><!--AURONA_RENDER_SLOT--></article>
  
  <!-- 必需：宿主将诊断状态信息注入此处 -->
  <div id="status"><!--AURONA_STATUS_SLOT--></div>
</body>
</html>
```

---

## 6. 权限系统与运行边界约束

### 6.1 细粒度权限控制
- `editor.current.read`：授权后允许扩展读取当前活动标签页的文档快照及选区；未授权时返回空快照；
- `workspace.read`：授权后允许扩展读取工作区元数据及限定范围内的文件；
- 用户的权限决策会在本地持久化，并按工作区根目录严格进行域隔离。

### 6.2 路径防逃逸保护
当扩展调用 `read-workspace-file("foo/bar.txt")` 或 `list-workspace-files("src", 50)` 时，宿主核心将执行：
1. 拦截 `..` 父级穿越组件；
2. 拦截绝对路径（如 `/etc/passwd`、`C:\Windows`）；
3. 拦截 Windows 盘符与 UNC 共享路径；
4. 规范化（`canonicalize`）后校验最终路径是否严格以工作区根目录为前缀。

---

## 7. 打包、构建与调试排错 FAQ

### 7.1 打包命令
项目根目录提供了全自动化打包与校验脚本：

```bash
# 编译 WASM 并自动打包为 .aurx 格式
pnpm run build:markdown

# 严格校验 .aurx 归档完整性
pnpm run verify:markdown
```

### 7.2 常见问题排查 (FAQ)

- **Q: 为什么编译时提示 `can't find crate for core: wasm32-wasip2 may not be installed`？**
  - **A**: 运行 `rustup target add wasm32-wasip2` 即可补充安装该目标平台。
- **Q: 插件为什么无法访问外部网络？**
  - **A**: Aurona Code 遵循零信任沙箱原则，扩展 WASM 运行时与 UI iframe 均封禁了直接网络 Socket 和 Fetch 权限，保证绝对的数据资产安全。
- **Q: 如何在插件中适配暗色模式？**
  - **A**: 宿主会在切换主题时自动同步 HTML 根节点的 `data-theme="dark"` / `data-theme="light"` 属性，CSS 中只需编写 `:root[data-theme="dark"]` 样式选择器即可实现即时切换。
