<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="104" />
  <h1>Aurona Code</h1>
  <p><strong>写代码这件事，值得一个更舒服、更安静的角落</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version" src="https://img.shields.io/badge/version-0.4.0-pioneer.6-2563eb" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24c8db" />
    <img alt="WASM" src="https://img.shields.io/badge/WASM-Component%20Model-654ff0" />
    <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" />
  </p>
</div>

---

Aurona Code 是一款基于 **Tauri 2 + React 19 + Rust** 构建的现代桌面代码编辑器。它不依赖 Monaco/Electron，而是从零自研编辑器引擎与 WebAssembly (WASI P2) 扩展沙箱，打造轻量、克制且具触感美学的沉浸式编码工作台。

> [!NOTE]
> **Aurona Code Pioneer 6 首启体验版本** 当前版本为 **V0.4.0-pioneer.6**。本版本带来主程序内嵌的首启欢迎引导（OOBE）与安装器三语选择器，落地退出清理队列与 WebView 缓存生命周期治理，重构空间管理界面，并对 Release 构建与性能基准模型进行双向优化。

---

## 核心特性

- **自研纯粹内核与 Canvas 2D Minimap**：自研 `AuronaEngine` 虚拟滚动视口 + 交互式代码小地图 + 彩虹嵌套括号与代码折叠。
- **语言服务解耦与共享运行时池**：主程序彻底剔除臃肿的预置工具链二进制；LSP 语言服务全部转为市场化动态按需加载，单套 Node.js 共享运行时池跨语言服务复用。
- **异步流式下载彻底防 OOM 崩溃**：Rust 端采用 `reqwest::Response::chunk()` 流式分块落盘，多线程异步非阻塞，根除大文件下载导致的内存崩溃与 UI 掉帧。
- **页面状态常驻保活 (Tab Keep-Alive)**：设置、扩展市场、关于及 Fliuno 等内置标签页采用常驻挂载与绘制隔离机制，切换页面不丢失任何输入与滚动状态。
- **Aurona Account 账号认证**：基于标准 OIDC/PKCE 协议的桌面端账号登录与令牌自动续期，打通跨端收藏与真实用户评价。
- **Aurona Marketplace 插件市场**：沉浸式毛玻璃详情页、一键复制 Identifier、更新与卸载分离操作、WASI 0.2 沙箱权限审查、安全审计评分、设备维度下载量统计与真实评价互动。
- **面向对象 SDK v1 与 VSCode 转译层**：固化 SDK v1 契约（Fliuno 搜索注入、沙箱 Storage、Dialog 交互），支持标准 `.vsix` 扩展原生解包转译运行。
- **双渠道与 Feature Flags 架构**：Stable 正式版与 Pioneer 先锋测试通道无缝切换，iOS Developer Beta 模式分发。
- **Fliuno 统一搜索**：命令、文件、符号、设置与内容一键直达，键盘优先导航。
- **集成透明终端**：基于 `portable-pty` 与 `xterm.js`，与主题卡片背景浑然一体。
- **全链路国际化**：简体中文 (zh-CN)、繁體中文 (zh-Hant) 与 English 实时无缝切换。
- **首启欢迎引导 (OOBE) 与安装器多语言**：Windows 安装程序支持简体中文、繁體中文与 English 界面语言选择；首次启动主程序直接呈现全屏欢迎引导（欢迎 → 语言 → 外观主题 → 账户登录，可跳过），完整复用整套主题系统，完成直达工作台。
- **权限安全生命周期**：卸载插件立即彻底销毁并持久化清除所有授权，严格保护用户工作区数据。

---

## 官方扩展与语言服务矩阵

Aurona Code 使用 Marketplace 分发 WASM 扩展、语言服务包与公共基础运行时：

| 资产名称 | 唯一标识符 ID | 资产类型 | 特性描述 |
| :--- | :--- | :--- | :--- |
| **Markdown 预览** | `auronalabs.markdown` | WASM 扩展包 (`.aurx`) | 实时双向同步预览、结构化大纲树、GFM 规范支持 |
| **任务面板** | `auronalabs.planner` | WASM 扩展包 (`.aurx`) | 敏捷看板、多级任务清单、测试用例追踪、Markdown 导出 |
| **Python 语言服务** | `auronalabs.lsp-pyright` | LSP 语言服务包 | 基于 Pyright，提供 Python 3.x 静态类型检查与智能补全 |
| **TypeScript / JS 语言服务** | `auronalabs.lsp-typescript` | LSP 语言服务包 | 基于 TS Language Server，提供全栈代码智能与重构 |
| **Node.js 官方公共运行时** | `auronalabs.runtime-node` | 共享运行时包 (`.zip`) | Node.js 22.22.0 LTS 隔离环境，供所有 Node-based LSP 共享复用 |
| **VSCode 兼容内核** | `aurona.vscode-compat` | 内置运行时 | 为标准 `.vsix` 扩展提供 API 转译与安全沙箱 |
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

# 2. 准备 VSCode 兼容运行时（语言服务按需在设置中安装）
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
pnpm run test:frontend  # 运行前端 Vitest 单元测试 (233 项)
pnpm run test:rust      # 运行 Rust 核心单元测试 (86 项)
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
