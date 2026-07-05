<div align="center">
  <br />
  <img src="public/logo.png" alt="Aurona Code Logo" width="120" />
  <h1 style="font-family: 'Righteous', sans-serif;">Aurona Code</h1>
  <p><strong>基于 Tauri 与 React 构筑的新一代轻量级桌面代码编辑器</strong></p>
  
  <p>
    <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=for-the-badge" alt="License" /></a>
    <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-V2-FFC131?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri" /></a>
    <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=black" alt="React" /></a>
    <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-Safe-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" /></a>
  </p>
</div>

---

<br />

> [!NOTE]
> **早期版本声明**
> 
> Aurona Code 目前处于早期快速迭代开发阶段。为了在早期发展阶段最大程度保护开源成果及用户安全，本项目目前采用 **AGPL 3.0** 开源许可证进行分发。当前早期版本已开启 **Windows、macOS 与 Linux 全平台构建**，且界面仅提供**简体中文**支持。

<br />

## 0.2.0 新纪元：Corona+ 架构

Aurona Code 迎来了史诗级的大版本更新，我们正式步入 **Corona+** 时代。本次大迭代彻底剥离了早期的历史包袱，在底层基建与交互设计上迎来了双重飞跃。

| 特性 | 详情描述 |
| :--- | :--- |
| **极客玻璃态美学** | 全局引入 `frosted-glass` 材质，系统菜单、设置中心、编辑器界面均采用了更现代的毛玻璃透视效果，呈现极致的悬浮感与通透性。 |
| **交互逻辑升级** | 全面整合 Radix UI 无头组件库并重构底层事件流，首发支持强大的全局右键菜单及文本快速编辑交互。 |
| **底层 IPC 隔离** | UI 表现层与后端 Tauri API（invoke/listen）彻底物理隔离，全面收拢至底层 `Foundation/IPC` 模块，极大增强系统的安全边界与可维护性。 |
| **Rust 进程守护** | 通过原子锁与 `Drop` 生命周期钩子守护 PTY 终端进程与 LSP 语言服务。杜绝僵尸进程，保证编辑器在意外退出时本地资源的绝对安全。 |

<br />

## 技术栈基石

我们精挑细选了现代 Web 与系统编程领域最前沿、最高效的技术，为您打造丝滑的本地编码体验。

- **系统核心**: [Tauri v2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/)
- **渲染引擎**: [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **设计系统**: [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/)
- **编辑内核**: [AuronaEngine] (自研轻量级代码编辑引擎)
- **终端生态**: [xterm.js](https://xtermjs.org/) + `portable-pty`

<br />

## 环境配置与运行指引

首次拉取代码后，我们推荐您使用项目内置的 `manager.py` 自动化管理脚本。

1. **环境准备**：请确保您的计算机已安装 [Node.js](https://nodejs.org/) 与 [Rust](https://www.rust-lang.org/) 环境，以及 [Python](https://www.python.org/) 以运行管理脚本。
2. **克隆代码**：
   ```bash
   git clone https://github.com/AuronaLabs/AuronaCode-Early.git
   cd AuronaCode-Early
   ```
3. **安装依赖**：
   ```bash
   npm install
   ```
4. **启动调试**：
   在根目录运行以下命令打开交互式极客风管理面板，选择对应的功能启动：
   ```bash
   python manager.py
   ```

<br />

## 参与社区贡献

我们热切欢迎并且期待您的 PR 与 Issue！在提交任何合并请求前，请务必阅读我们的 [文档目录](docs) 中关于 Corona 架构和设计规范的要求。

> [!CAUTION]
> 发现安全漏洞时，请**绝对不要**在公共页面（如 Issue 区）中讨论。请严格按照 [安全策略](.github/SECURITY.md) 的流程进行私密报告，我们将第一时间予以响应。

<br />

---

<div align="center">
  <p>本项目受 <a href="LICENSE">GNU Affero General Public License v3.0</a> 许可证保护。</p>
  <p>Made with ❤️ by AuronaLabs</p>
</div>
