# Aurona Code 扩展开发实战指南

Aurona Code 提供了基于 **WebAssembly Component Model (WASI P2)** 的现代插件系统。开发者可以使用 Rust 或转译脚本编写扩展，打包为 `.aurx` 归档并在沙箱中安全运行。

---

## 1. 扩展归档规范 (.aurx)

扩展包文件为一个基于 ZIP-Store 规范的归档包，固定包含以下文件：

```text
my-extension.aurx
├── manifest.json       # 扩展元数据、ID、侧边栏声明与入口
├── extension.wasm      # WASM 虚拟机组件字节码 (wasm32-wasip2)
├── ui/
│   └── index.html      # 视图模板（包含 CSP 与 <!--AURONA_RENDER_SLOT-->）
└── assets/
    └── icon.svg        # 侧边栏矢量图标 (SVG)
```

### 1.1 `manifest.json` 结构
```json
{
  "packageVersion": 1,
  "id": "vendor.my-extension",
  "name": "My Extension",
  "displayName": {
    "zh-CN": "我的扩展",
    "zh-Hant": "我的擴充",
    "en": "My Extension"
  },
  "publisher": "vendor",
  "version": "0.1.0",
  "engine": {
    "auronaCode": ">=0.3.12"
  },
  "runtime": {
    "component": "extension.wasm"
  },
  "sidebar": {
    "title": "My Tool",
    "displayTitle": {
      "zh-CN": "我的工具",
      "en": "My Tool"
    },
    "icon": "assets/icon.svg"
  },
  "view": {
    "entry": "ui/index.html"
  }
}
```

---

## 2. 官方三大内置扩展解析

| 扩展 ID | 扩展名称 | 运行模式 | 核心能力 |
| :--- | :--- | :--- | :--- |
| `aurona.markdown` | **Markdown 实时预览** | 编辑器绑定 | 实时监听当前激活的 Markdown 文档并极速流式渲染为精美 HTML |
| `aurona.planner` | **任务与测试计划看板** | 独立运行 | 独立任务管理看板，支持分类/优先级，自动安全持久化到 `.aurona/planner.json` |
| `aurona.vscode-compat` | **VSCode 兼容转译层** | 独立运行 | 提供 VSCode API 模拟层与 Node 安全沙箱，共用转译并执行 VSCode 插件 |

---

## 3. 从零创建新扩展流程

### 3.1 创建 Rust 扩展工程
```bash
cargo new --lib Extensions/my.extension
```

在 `Cargo.toml` 中配置：
```toml
[package]
name = "my-extension"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wit-bindgen = "0.58"

[profile.release]
opt-level = "s"
lto = true
strip = true
panic = "abort"
```

### 3.2 编写 `src/lib.rs`
```rust
use exports::aurona::extensions::render::{Guest, RenderInput, RenderOutput};

wit_bindgen::generate!({
    path: "../wit/world.wit",
    world: "aurona-extension",
});

struct MyExtension;

impl Guest for MyExtension {
    fn render(input: RenderInput) -> Result<RenderOutput, String> {
        let env = aurona::extensions::context::get_environment();
        let check_icon = aurona::extensions::context::get_icon_svg("check").unwrap_or_default();
        
        Ok(RenderOutput {
            html: format!("<div class=\"content\"><h2>你好，{}!</h2>{}</div>", env.locale, check_icon),
            diagnostics: Vec::new(),
        })
    }
}

export!(MyExtension);
```

### 3.3 编译与构建归档
```bash
# 编译 WASM
cargo build --manifest-path Extensions/my.extension/Cargo.toml --target wasm32-wasip2 --release

# 打包为 aurx 产物
node scripts/build-my-extension.mjs
```
