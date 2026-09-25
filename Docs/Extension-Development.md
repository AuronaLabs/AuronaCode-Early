# Aurona Code 扩展开发实战指南

## V0.4.11 SDK 边界

当前开发版本为 `0.4.11`。应用安装包只内置 VSCode 兼容层和 Demo 插件；Markdown、Planner、LSP 与 Runtime 通过 Marketplace 分发。扩展 API、权限、Runtime 和版本字段以 Marketplace 服务端契约为准，发布前应同时验证本地开发地址和线上 API 地址。

## Pioneer 6 UI 约束

扩展 UI 继续复用 Aurona 的 `Button`、`Input`、`Select`、`Switch`、`Card` 和 `GlassContainer`。扩展不得通过页面级 class 创建新的 surface 层级、嵌套大卡片或依赖装饰性渐变表达结构；详情、设置和工具链状态应使用标题、分隔线与明确的 loading/empty/error 状态。

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

## 2. Marketplace 扩展与内置兼容内核

| 扩展 ID | 扩展名称 | 运行模式 / 资产类型 | 核心能力 |
| :--- | :--- | :--- | :--- |
| `auronalabs.markdown` | **旧版 Markdown 预览** | 过渡期 Marketplace `.aurx` 扩展 | 编辑器已内置 Markdown/GFM 预览；该扩展不随应用安装，后续将从 Marketplace 下线 |
| `auronalabs.planner` | **任务面板** | Marketplace `.aurx` 扩展 | 独立任务管理看板，支持分类/优先级，自动安全持久化到 `.aurona/planner.json` |
| `auronalabs.lsp-pyright` | **Python 语言服务** | Marketplace LSP 包 | 基于 Microsoft Pyright 的 Python 3.x 静态类型检查与智能语义服务 |
| `auronalabs.lsp-typescript` | **TypeScript 语言服务** | Marketplace LSP 包 | 基于 typescript-language-server 的前端全栈代码智能服务 |
| `auronalabs.runtime-node` | **官方共享运行时** | 共享环境包 (`.zip`) | Node.js 22.22.0 LTS 隔离基础运行时，供所有 Node-based LSP 共享使用 |
| `aurona.vscode-compat` | **VSCode 兼容内核** | 应用内置运行时 | 基于 Boa 引擎在 WASM 沙箱内真实执行 `.vsix` 扩展的 JavaScript 主入口；不作为可安装、可卸载或侧边栏扩展展示 |
| `vscode-demo` | **VSCode Demo 测试插件** | 随包内置 `.vsix` | 官方标准 VSCode 插件包，经 设置 → 扩展 →「VSCode 测试插件」一键装载，用于验证兼容层执行链路 |

### 2.1 Marketplace 元数据、LSP 分发与权限规范

- **LSP 语言服务托管**：Marketplace 统一托管 WASM 扩展与 LSP 工具链包，按需下载并在 APPDATA 运行。
- **共享环境协同检测**：依赖 Node.js 的 LSP 服务在安装时将协同检测 `auronalabs.runtime-node`，免去重复下载。
- **权限安全生命周期**：扩展卸载时系统将彻底清除该扩展所有已授权的工作区权限与持久化记录。
- **权威元数据驱动**：Marketplace 扩展与 LSP 的名称、描述、版本、权限、文件大小与更新日志由 Marketplace API 作为权威来源，Aurona Code 负责缓存与离线可用性。
- 当扩展首次请求敏感能力时，Aurona Code 显示授权弹窗；用户可选择仅允许一次、始终允许或拒绝。一次性许可仅在本次应用进程中有效。

---

## 2.1 扩展 UI 双模演进体系 (Dual UI Modes)

Aurona Code 支持两种插件界面构建范式，插件开发者可根据需求自由选择：

1. **官方原生拟物组件模式 (Declarative Native UI)**：
   - 插件直接复用 Aurona 宿主提供的官方 React 现代拟物组件库（`Select`、`Button`、`Switch`、`Card`、`Tag`、`GlassContainer`）；
   - **优势**：开箱即用，100% 继承工作台当前主题色彩、毛玻璃渐变与流动光效，体积零额外开销。
2. **自定义 Webview 容器模式 (Custom Webview Host)**：
   - 插件通过 WASM / HTML 契约完全自主绘制 HTML/CSS/Canvas 视图；
   - **优势**：极高自由度，适合 Markdown 实时富文本渲染、图表绘制、复杂游戏或自研 UI 引擎。

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
