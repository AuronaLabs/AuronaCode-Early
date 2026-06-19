<div align="center">
  <h1>Aurona Code</h1>
  <p><strong>新一代轻量级、高性能桌面代码编辑器</strong></p>
  <p>基于 Tauri、React 19 与 Tailwind CSS 构建，专为现代开发工作流设计。</p>
  
  [![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
  [![Tauri](https://img.shields.io/badge/Tauri-V2-orange.svg)](https://tauri.app/)
  [![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
</div>

<hr />

## 早期版本声明 (Early Access Notice)

**Aurona Code 目前处于早期快速迭代开发阶段（Alpha / Early Access）。** 

为了在早期发展阶段最大程度地保护开源成果及用户安全，本项目目前采用严格的 **AGPL 3.0** 开源许可证进行分发。

另外请注意：**当前早期版本仅提供中文 (Simplified Chinese) 支持。** 国际化 (i18n) 与多语言适配将在后续功能趋于稳定后正式推出。

## 核心特性

* **极速启动与低内存占用**：依托 Rust 语言与 Tauri 架构，彻底摒弃了传统 Electron 框架的沉重包袱。
* **现代设计哲学**：采用无边框与圆角设计语言，全面应用 Tailwind CSS 打造精细、统一的原生级 IDE 视觉体验。
* **专业级编辑核心**：内置深度定制的 Monaco Editor，提供媲美 VS Code 的智能补全、语法高亮与丝滑的编码体验。
* **高性能终端集成**：集成底层 PTY（伪终端）技术与 xterm.js，支持无缝、高速地执行各类命令行操作。
* **原生版本控制系统**：内置 Git 源代码管理面板，直观可视化地追踪文件变更、提交历史与分支结构。
* **集中化配置管理**：提供统一、清晰的全局设置中心与缓存管理机制。

## 技术架构

* **底层框架**: [Tauri v2](https://v2.tauri.app/) (Rust)
* **前端框架**: [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
* **样式方案**: [Tailwind CSS v4](https://tailwindcss.com/)
* **编辑器内核**: [Monaco Editor](https://microsoft.github.io/monaco-editor/)
* **终端实现**: [xterm.js](https://xtermjs.org/) + `portable-pty`

## 环境配置与运行指南

### 环境依赖

在开始之前，请确保您的操作系统已安装以下必需的运行环境：

- [Node.js](https://nodejs.org/) (建议版本 v18.0.0 或更高)
- [Rust](https://www.rust-lang.org/) (最新稳定版本)
- [Python 3.x](https://www.python.org/) (用于执行 manager.py 管理脚本)
- [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (仅限 Windows 平台开发者需要)

### 代码初始化

1. 克隆项目源代码：
```bash
git clone https://github.com/AuronaLabs/AuronaCode-Early.git
cd AuronaCode-Early
```

2. 安装前端依赖库：
```bash
npm install
```

### 启动开发环境

我们提供了两种启动开发模式的方式，您可以根据习惯自行选择：

**方式一：使用 NPM 脚本 (标准方式)**
```bash
npm run tauri:dev
```

**方式二：使用 Python 管理脚本 (推荐)**
为了简化开发工作流，项目内置了 `manager.py` 脚本：
```bash
python manager.py dev
```

### 构建与打包可执行文件

当需要编译并打包正式的桌面可执行程序时，**强烈建议使用内置的管理脚本进行构建**，它会自动处理复杂的环境与清理工作：

```bash
python manager.py build
```

编译完成后，最终的安装程序包 (Setup.exe) 将会生成在 `src-tauri/target/release/bundle/nsis/` 目录下。

> [!NOTE]
> **关于跨平台支持**
> 目前 Aurona Code 官方团队仅提供 **Windows (x64)** 平台的预编译安装包。macOS 与 Linux 用户可通过上述步骤自行拉取代码并在本地进行编译打包。

## 参与贡献

我们欢迎并感谢社区开发者的参与和贡献。在提交 Pull Request 之前，请务必阅读我们的 [贡献指南](https://github.com/AuronaLabs/AuronaCode-Early/blob/main/.github/CONTRIBUTING.md) 和 [行为准则](https://github.com/AuronaLabs/AuronaCode-Early/blob/main/.github/CODE_OF_CONDUCT.md)。

如果您发现了任何潜在的安全漏洞，请勿在公共 Issue 中讨论，请优先通过我们的 [安全策略](https://github.com/AuronaLabs/AuronaCode-Early/blob/main/.github/SECURITY.md) 流程进行私密报告。

## 许可证声明

本项目受 [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) 许可证保护。
相关授权与限制条款，请详细参阅项目根目录下的 `LICENSE` 文件。
