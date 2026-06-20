<div align="center">
  <h1>Aurona Code</h1>
  <p><strong>基于 Tauri 与 React 构建的轻量级桌面代码编辑器</strong></p>
  
  [![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
  [![Tauri](https://img.shields.io/badge/Tauri-V2-orange.svg)](https://tauri.app/)
  [![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
</div>

<hr />

## 早期版本声明 (Early Access Notice)

**Aurona Code 目前处于早期快速迭代开发阶段（Alpha / Early Access）** 

为了在早期发展阶段最大程度地保护开源成果及用户安全，本项目目前采用 **AGPL 3.0** 开源许可证进行分发
当前早期版本仅提供**简体中文 (Simplified Chinese)** 支持 国际化 (i18n) 适配将在核心功能稳定后推出

## 核心特性

* **基于 Tauri 的底层架构**：采用 Rust 与 Tauri 替代 Electron，以优化启动速度与内存开销
* **原生级 UI 体验**：使用 Tailwind CSS 构建无边框、高透明度的现代操作系统级界面
* **Monaco Editor 集成**：深度集成 Monaco Editor，提供基础的多语言语法高亮与代码提示
* **内置 PTY 终端**：基于 xterm.js 与 portable-pty，支持完整的本地命令行交互
* **可视化 Git 管理**：后台预加载机制的 Git 面板，支持直观的文件暂存、提交与历史追踪
* **集中化状态管理**：提供基于 JSON 的统一配置中心与持久化缓存机制

## 技术架构

* **底层框架**: [Tauri v2](https://v2.tauri.app/) (Rust)
* **前端框架**: [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
* **样式方案**: [Tailwind CSS v4](https://tailwindcss.com/)
* **编辑器内核**: [Monaco Editor](https://microsoft.github.io/monaco-editor/)
* **终端实现**: [xterm.js](https://xtermjs.org/) + `portable-pty`

## 管理脚本 (Manager.py) 指南

本项目内置了一个强大的交互式 CLI 管理脚本 `manager.py`，用于接管所有构建、清理、环境检查与配置更新流程

在根目录终端运行以下命令进入交互菜单：

```bash
python manager.py
```

进入后，您只需输入对应功能的**数字序号**即可执行操作：
- `[ 1 ]` 启动 Tauri 开发服务器 (等同于 npm run tauri:dev)
- `[ 4 ]` 全局同步包版本号 (同时更新 package.json / Cargo.toml / tauri.conf)
- `[ 6 ]` 执行 Tauri Release 打包 (生成 NSIS 安装包)
- `[ 7 ]` 交互式修改 Tauri 配置与应用 GUID
- `[ 8 ]` **检查并自动配置系统开发环境** (检测并安装 Node/Rust/Tauri CLI)

## 环境配置与运行指引

在首次拉取代码后，推荐使用 `manager.py` 提供的选项 `[ 8 ]` 自动检查并补全开发环境

如果希望手动进行：
1 请确保系统中安装有 [Node.js](https://nodejs.org/) (>=v18) 与 [Rust](https://www.rust-lang.org/)
2 克隆项目源代码：
```bash
git clone https://github.com/AuronaLabs/AuronaCode-Early.git
cd AuronaCode-Early
```
3 安装前端依赖库：
```bash
npm install
```
4 运行 `python manager.py` 并选择 `[ 1 ]` 启动开发服务器

## 参与贡献

我们欢迎社区开发者的参与 在提交 Pull Request 之前，请务必阅读我们的 [贡献指南](.github/CONTRIBUTING.md) 和 [行为准则](.github/CODE_OF_CONDUCT.md)

> [!CAUTION]
> 如果您发现了任何潜在的安全漏洞，请**不要**在公共 Issue 中讨论 请严格按照 [安全策略 (SECURITY.md)](.github/SECURITY.md) 流程进行私密报告

## 许可证声明

本项目受 [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) 许可证保护
相关授权与限制条款，请详细参阅项目根目录下的 `LICENSE` 文件
