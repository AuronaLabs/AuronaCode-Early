<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="104" />
  <h1>Aurona Code</h1>
  <p><strong>写代码这件事，值得一个更舒服、更安静的角落</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version" src="https://img.shields.io/badge/version-0.3.15-2563eb" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24c8db" />
    <img alt="WASM" src="https://img.shields.io/badge/WASM-Component%20Model-654ff0" />
    <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" />
  </p>
</div>

---

Aurona Code 是一款基于 **Tauri 2 + React 19 + Rust** 构建的现代桌面代码编辑器。它不依赖 Monaco/Electron，而是从零自研编辑器引擎与 WebAssembly (WASI P2) 扩展沙箱，打造「更轻量、更克制、更具触感美学」的沉浸式编码工作台。

> [!NOTE]
> Aurona Code 处于快速演进阶段。已具备日常编辑、多语言 LSP、Git 流程、集成终端、WASM 扩展与双渠道更新能力。欢迎体验与共建！

---

## 🌟 核心特性

- ⚡ **自研纯粹内核与 Canvas 2D Minimap**：自研 `AuronaEngine` 虚拟滚动视口 + 交互式代码小地图 + 彩虹嵌套括号与代码折叠；
- 🎨 **现代拟物美学**：8 套定制双色渐变主题 × 浅色/深色自适应，毛玻璃微边框与沉浸式圆角；
- 🧩 **面向对象 SDK 与 WASM 扩展沙箱**：基于 `Wasmtime 47.x` 与纯正面向对象 Aurona SDK，内置 VSCode API 转译兼容层；
- 🔄 **双渠道与 Feature Flags 架构**：Stable 正式版与 Pioneer 先锋测试通道无缝切换，iOS Developer Beta 模式智能分发；
- 🔍 **Fliuno 统一搜索**：命令、文件、符号、设置与内容一键直达，键盘优先导航；
- 💻 **集成透明终端**：基于 `portable-pty` 与 `xterm.js`，与主题卡片背景浑然一体；
- 🌐 **全链路国际化**：简体中文 (zh-CN)、繁體中文 (zh-Hant) 与 English 实时无缝切换；
- 🛡️ **安全沙箱与零遥测**：严格的文件系统工作区边界防御，无任何隐私上传与行为监控。

---

## 📦 官方内置扩展矩阵 (.aurx)

Aurona Code 现已内置三款基于 WASM Component 的官方扩展：

| 扩展名称 | 扩展 ID | 运行模式 | 特性描述 |
| :--- | :--- | :--- | :--- |
| **Markdown 实时预览** | `aurona.markdown` | 编辑器绑定 | 实时监听当前 Markdown 并以极速流式渲染，排版精准优雅 |
| **任务与测试看板** | `aurona.planner` | 独立运行 | 独立任务管理插件，集成 Tabler 矢量图标 SDK 与官方原生组件，数据安全持久化于工作区 |
| **VSCode 兼容转译层** | `aurona.vscode-compat` | 独立运行 | 提供 VSCode API 模拟与 Node 安全沙箱，共用转译并执行 VSCode 扩展 |

> 🧩 **全新 UI 双模架构 (Dual UI Modes)**：插件开发者可自由选择**「官方原生声明式组件模式 (Declarative Native UI)」**（直接复用官方 Select、Switch、Card、Button 等组件，零额外体积开销）或**「自定义 Webview 容器模式 (Custom Webview Host)」**（完全自主绘制 HTML/CSS/Canvas 视图）。

---

## 🏗️ 系统架构

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

## 🚀 快速上手与本地开发

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

# 2. 准备内置工具链与三大扩展
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
pnpm run test:frontend  # 运行前端 Vitest 单元测试 (184 项)
pnpm run test:rust      # 运行 Rust 核心单元测试
```

---

## 📚 官方文档索引

- [系统全景架构设计](docs/Architecture.md)
- [WASM 扩展开发实战指南](docs/Extension-Development.md)
- [Extension SDK 参考手册](docs/Extension-SDK-Reference.md)
- [设计哲学与材质规范](docs/Design-Principles.md)
- [产品愿景与演进路线](docs/Product-Vision.md)

---

## 📄 许可证

本项目采用 [AGPL-3.0](LICENSE) 开源协议。
