<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="104" />
  <h1>Aurona Code</h1>
  <p><strong>写代码这件事，值得一个更舒服、更安静的角落</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version" src="https://img.shields.io/badge/version-0.4.0-pioneer.3-2563eb" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24c8db" />
    <img alt="WASM" src="https://img.shields.io/badge/WASM-Component%20Model-654ff0" />
    <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" />
  </p>
</div>

---

Aurona Code 是一款基于 **Tauri 2 + React 19 + Rust** 构建的现代桌面代码编辑器。它不依赖 Monaco/Electron，而是从零自研编辑器引擎与 WebAssembly (WASI P2) 扩展沙箱，打造轻量、克制且具触感美学的沉浸式编码工作台。

> [!NOTE]
> **Aurona Code 正式开启 0.4.0 演进周期！** 当前版本为 **V0.4.0-pioneer.3** 先锋测试版，Pioneer 先锋尝鲜机制与双渠道物理 Feature Flags 架构已全面上线，欢迎体验与共建！

---

## 核心特性

- **自研纯粹内核与 Canvas 2D Minimap**：自研 `AuronaEngine` 虚拟滚动视口 + 交互式代码小地图 + 彩虹嵌套括号与代码折叠。
- **页面状态常驻保活 (Tab Keep-Alive)**：设置、扩展市场、关于及 Fliuno 等内置标签页采用常驻挂载与绘制隔离机制，切换页面不丢失任何输入与滚动状态。
- **Aurona Account 账号认证**：基于标准 OIDC/PKCE 协议的桌面端账号登录与令牌自动续期，打通跨端收藏与真实用户评价。
- **设置中心快速定位 (Deep Link)**：支持从全局搜索与快捷命令直接直达具体设置项，并触发平滑滚动与高亮动画。
- **通知中心分类与静音免打扰**：支持按系统、扩展、更新等多维度筛选通知，并支持非重要通知静音免打扰与弹窗停留时长自定义。
- **Aurona Marketplace 插件市场**：统一使用 Marketplace 元数据与本地缓存；支持直接安装、悬停卸载、版本更新、权限清单审查、安全审计评分、星标收藏与真实评价互动。
- **面向对象 SDK v1 与 VSCode 转译层**：固化 SDK v1 契约（Fliuno 搜索注入、沙箱 Storage、Dialog 交互），支持标准 `.vsix` 扩展原生解包转译运行。
- **双渠道与 Feature Flags 架构**：Stable 正式版与 Pioneer 先锋测试通道无缝切换，iOS Developer Beta 模式分发。
- **Fliuno 统一搜索**：命令、文件、符号、设置与内容一键直达，键盘优先导航。
- **集成透明终端**：基于 `portable-pty` 与 `xterm.js`，与主题卡片背景浑然一体。
- **全链路国际化**：简体中文 (zh-CN)、繁體中文 (zh-Hant) 与 English 实时无缝切换。
- **iOS 风格权限与零遥测**：插件首次请求敏感能力时可选择仅允许一次、始终允许或拒绝；一次性许可不会写入磁盘。

---

## 官方扩展与演示矩阵

Aurona Code 使用 Marketplace 分发 WASM 扩展，并内置 VSCode 兼容运行内核：

| 扩展名称 | 扩展 ID | 打包格式 | 特性描述 |
| :--- | :--- | :--- | :--- |
| **Markdown 预览** | `auronalabs.markdown` | Marketplace `.aurx` | 从 Marketplace 安装；名称、版本、权限与更新日志以 Marketplace 为准 |
| **任务面板** | `auronalabs.planner` | Marketplace `.aurx` | 从 Marketplace 安装；支持直接安装、更新与卸载 |
| **VSCode 兼容内核** | `aurona.vscode-compat` | 内置运行时 | 不显示为侧边栏插件；为 VSIX 提供 API 转译与安全沙箱 |
| **VSCode Bridge Demo** | `vscode-demo` | `.vsix` (Standard) | 官方标准 VSCode 插件包，由底层兼容层原生转译执行 |

> **全新 UI 双模架构 (Dual UI Modes)**：插件开发者可自由选择**「官方原生声明式组件模式 (Declarative Native UI)」**（直接复用官方 Select、Switch、Card、Button 等组件，零额外体积开销）或**「自定义 Webview 容器模式 (Custom Webview Host)」**（完全自主绘制 HTML/CSS/Canvas 视图）。

---

## 系统架构

```text
React UI / Features (React 19)
  ├── AuronaEngine (自研虚拟视口编辑器 Hook 体系: Selection, Keybindings, Autocomplete)
  ├── Fliuno (统一搜索与命令中心)
  ├── Workspace / Layout (ActivityBar, Sidebar, Modals, Bottom Panels)
  ├── Extensions View Host (Sandboxed Plugin WebView)
  └── Foundation (I18n, EventBus, IPC Bridge)
        │
        ▼ (Tauri 2 Typed IPC)
Rust Core Runtime (aurona_code_lib)
  ├── EditorEngine (Ropey, Revision, Highlights, Undo/Redo)
  ├── ExtensionRuntime (Wasmtime 47.x, Component Model, Fuel/Memory Limit)
  ├── Workspace / FileSystem (Security boundary verification)
  ├── Toolchains / LSP / DAP (TypeScript, Python, DAP Sessions)
  ├── Git (Protected Subprocess Groups)
  └── Performance / Diagnostics (Benchmarks & Telemetry)
```

---

## 快速上手与本地开发

### 1. 环境准备
- [Node.js](https://nodejs.org/) (>= 22.x) 与 [pnpm](https://pnpm.io/) (>= 11.x)
- [Rust](https://rustup.rs/) (>= 1.95.0)，并安装 WASM 目标：
  ```bash
  rustup target add wasm32-wasip2
  ```

### 2. 构建与运行
```bash
# 1. 安装前端与构建依赖
pnpm install

# 2. 准备内置工具链与 VSCode 兼容运行时
pnpm run prepare:toolchains
pnpm run prepare:extensions

# 3. 启动桌面端开发热重载
pnpm run tauri:dev
```

### 3. 质量门禁与测试指令
```bash
pnpm run format         # 自动格式化前端代码 (Biome)
pnpm run typecheck      # TypeScript 类型检查
pnpm run check          # Biome 代码规范检查
pnpm run smoke          # 发布元数据烟雾检查
pnpm run test:frontend  # 运行前端 Vitest 单元测试 (204 项)
pnpm run test:rust      # 运行 Rust 核心单元测试 (89 项)
```

---

## 官方文档索引

- [系统全景架构设计](Docs/Architecture.md)
- [WASM 扩展开发实战指南](Docs/Extension-Development.md)
- [Extension SDK 参考手册](Docs/Extension-SDK-Reference.md)
- [设计哲学与材质规范](Docs/Design-Principles.md)
- [产品愿景与演进路线](Docs/Product-Vision.md)

---

## 许可证

本项目采用 [AGPL-3.0](LICENSE) 开源协议。
