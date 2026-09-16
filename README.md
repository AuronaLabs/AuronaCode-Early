<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="104" />
  <h1>Aurona Code</h1>
  <p><strong>写代码这件事，值得一个更舒服、更安静的角落</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version" src="https://img.shields.io/badge/version-0.4.3-2563eb" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24c8db" />
    <img alt="WASM" src="https://img.shields.io/badge/WASM-Component%20Model-654ff0" />
    <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" />
  </p>
</div>

---

Aurona Code 是一款基于 **Tauri 2 + React 19 + Rust** 构建的现代桌面代码编辑器。它不依赖 Monaco/Electron，而是从零自研编辑器引擎与 WebAssembly (WASI P2) 扩展沙箱，打造轻量、克制且具触感美学的沉浸式编码工作台。

> [!NOTE]
> **Aurona Code V0.4.3 代理 / 液态玻璃 / Fliuno 升级** 当前版本为 **V0.4.3**（Stable 正式通道）。本批次以网络代理、窗口体验与全局材质升级为主题：新增网络代理设置（跟随系统 / 自定义 / 直连），覆盖更新检查与工具链下载；窗口尺寸与位置跨会话记忆、首次启动自动最大化；OOBE 语言选择改为双列网格；控件圆角统一到新三档体系并重设计色彩主题选择器；流光升级为液态玻璃流光（多组有机光域 + 浮层折射 rim 与 specular 高光带，支持降级与强度联动）；修复内置扩展预览渲染失败与卸载"未找到"，Fliuno 菜单溢出改箭头滚动范式，搜索大小写/正则接入设置持久化并补齐分组结果渲染。

---

## 核心特性

- **自研纯粹内核与 Canvas 2D Minimap**：自研 `AuronaEngine` 虚拟滚动视口 + 交互式代码小地图 + 彩虹嵌套括号与代码折叠；全量撤销栈、多光标批量编辑、括号引号自动补对、词级跳转与光标跟随滚动，按键编辑走精确增量写盘，翻页与跳转平滑滚动。
- **语言服务解耦与共享运行时池**：主程序彻底剔除臃肿的预置工具链二进制；LSP 语言服务全部转为市场化动态按需加载，单套 Node.js 共享运行时池跨语言服务复用。
- **异步流式下载彻底防 OOM 崩溃**：Rust 端采用 `reqwest::Response::chunk()` 流式分块落盘，多线程异步非阻塞，根除大文件下载导致的内存崩溃与 UI 掉帧。
- **页面状态常驻保活 (Tab Keep-Alive)**：设置、扩展市场、关于及 Fliuno 等内置标签页采用常驻挂载与绘制隔离机制，切换页面不丢失任何输入与滚动状态。
- **Aurona Account 账号认证**：基于标准 OIDC/PKCE 协议的桌面端账号登录与令牌自动续期，打通跨端收藏与真实用户评价。
- **Aurona Marketplace 插件市场**：沉浸式毛玻璃详情页、一键复制 Identifier、更新与卸载分离操作、WASI 0.2 沙箱权限审查、安全审计评分、设备维度下载量统计与真实评价互动。
- **面向对象 SDK v1 与 VSCode 转译层**：固化 SDK v1 契约（Fliuno 搜索注入、沙箱 Storage、Dialog 交互），支持标准 `.vsix` 扩展原生解包转译运行。
- **双渠道与 Feature Flags 架构**：Stable 正式版与 Pioneer 先锋测试通道无缝切换，iOS Developer Beta 模式分发。
- **Fliuno 统一搜索**：命令、文件、符号、设置与内容一键直达，键盘优先导航，分组 sticky 结果渲染，大小写/正则偏好持久化。
- **网络代理设置**：跟随系统 / 自定义 / 直连三档代理，覆盖更新检查与语言服务器等工具链下载，自定义代理即时生效。
- **窗口状态记忆与液态玻璃流光**：窗口尺寸与位置跨会话记忆（异常自动回退最大化、首启自动最大化）；可开关的液态玻璃流光为背景与浮层玻璃带来折射质感，支持动效降级与三档强度联动。
- **集成透明终端**：基于 `portable-pty` 与 `xterm.js`，配色完整跟随明暗主题与强调色即时切换，背景与主题卡片浑然一体。
- **全链路国际化**：简体中文 (zh-CN)、繁體中文 (zh-Hant)、English、Deutsch、Italiano 与日本語实时无缝切换，语言选择以各语言自名显示。
- **首启欢迎引导 (OOBE) 与安装器多语言**：Windows 安装程序支持多语言界面选择；首次启动主程序直接呈现全屏欢迎引导（欢迎 → 语言 → 外观主题 → 账户登录，可跳过），完整复用整套主题系统，完成直达工作台。
- **权限安全生命周期**：卸载插件立即彻底销毁并持久化清除所有授权，严格保护用户工作区数据。

---

## 官方扩展与语言服务矩阵

Aurona Code 的扩展资产分为两组：**随安装包内置**（VSCode 兼容内核与官方测试插件，不占用侧边栏、不走 Marketplace）与**通过 Marketplace 分发**（WASM 扩展、LSP 语言服务包与公共基础运行时，按需安装）：

### 随安装包内置（2 个）

| 资产名称 | 唯一标识符 ID | 资产类型 | 特性描述 |
| :--- | :--- | :--- | :--- |
| **VSCode 兼容内核** | `aurona.vscode-compat` | 内置运行时 | 基于 Boa 引擎在 WASM 沙箱内真实执行标准 `.vsix` 扩展的 JavaScript 代码，提供 `vscode.commands` / `window` / `workspace.fs` / `env.clipboard` 等 API 相容层 |
| **VSCode Demo 测试插件** | `vscode-demo` | `.vsix` (Standard) | 官方标准 VSCode 插件包，随包内置但不自动装载；在 设置 → 扩展 →「VSCode 测试插件」中一键安装，用于验证兼容层真实执行链路 |

### 通过 Marketplace 分发（10 个）

| 资产名称 | 唯一标识符 ID | 资产类型 | 特性描述 |
| :--- | :--- | :--- | :--- |
| **Markdown 预览** | `auronalabs.markdown` | WASM 扩展包 (`.aurx`) | 实时双向同步预览、结构化大纲树、GFM 规范支持 |
| **任务面板** | `auronalabs.planner` | WASM 扩展包 (`.aurx`) | 敏捷看板、多级任务清单、测试用例追踪、Markdown 导出 |
| **Python 语言服务** | `auronalabs.lsp-pyright` | LSP 语言服务包 (`.aurlsp`) | 基于 Pyright，提供 Python 3.x 静态类型检查与智能补全 |
| **TypeScript / JS 语言服务** | `auronalabs.lsp-typescript` | LSP 语言服务包 (`.aurlsp`) | 基于 TS Language Server，提供全栈代码智能与重构 |
| **HTML / CSS / JSON 语言服务** | `auronalabs.lsp-web` | LSP 语言服务包 (`.aurlsp`) | 提供 HTML、CSS、SCSS、LESS、JSON 与 JSON Schema 语法感知、智能补全与实时校验 |
| **Rust 语言服务** | `auronalabs.lsp-rust` | LSP 语言服务包 (`.aurlsp`) | 基于 rust-analyzer 的官方原生 Rust 语义分析、类型推断、代码补全与宏展开 |
| **C / C++ 语言服务** | `auronalabs.lsp-clangd` | LSP 语言服务包 (`.aurlsp`) | 基于 LLVM Clangd 的企业级 C / C++ 高精度智能感知、交叉引用与重构 |
| **Go 语言服务** | `auronalabs.lsp-gopls` | LSP 语言服务包 (`.aurlsp`) | Google 官方 Gopls 引擎，提供精确自动导入、符号导航、代码补全与诊断 |
| **Vue 语言服务** | `auronalabs.lsp-vue` | LSP 语言服务包 (`.aurlsp`) | Vue 3 SFC 单文件组件官方智能感知，支持 TS 深度类型推断与模板语法校验 |
| **Node.js 官方公共运行时** | `auronalabs.runtime-node` | 共享运行时包 (`.zip`) | Node.js 22.x LTS 隔离环境，供所有 Node-based LSP 共享复用 |

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
pnpm run lint           # Biome 代码规范检查
pnpm run smoke          # 发布元数据烟雾检查
pnpm run test:frontend  # 运行前端 Vitest 单元测试 (241 项)
pnpm run test:rust      # 运行 Rust 核心单元测试 (99 项)
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
