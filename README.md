<div align="center">
  <br />
  <img src="public/logo.png" alt="Aurona Code Logo" width="120" />
  <h1>Aurona Code</h1>
  <p><strong>基于 Tauri 与 React 构筑的跨平台智能桌面代码编辑器</strong></p>
  
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

## 0.1.1 性能优化

Aurona Code V0.1.1 针对应用在处理大型项目时遇到的性能瓶颈进行了底层优化与架构调整，主要改善了并发吞吐量与全局状态更新时的 UI 流畅度。

| 特性 | 详情描述 |
| :--- | :--- |
| **终端并发优化** | Rust 后端 PTY 状态管理引入 `DashMap`，实现细粒度的并发锁隔离，减少多个终端实例同时运行时的资源竞争。 |
| **流式全盘检索** | 全局搜索迁移至 `WalkBuilder` 多线程执行，并通过 Tauri 事件流实时向前端推送搜索结果，降低检索大型项目时的首屏渲染延迟。 |
| **LSP 请求管理** | 完善了语言服务协议的生命周期控制，新增 `$/cancelRequest` 机制。在用户连续输入时自动取消已过期的代码补全请求，降低服务端计算开销。 |
| **构建与渲染优化** | 调整 Vite 构建配置的 `manualChunks`，独立打包大体积第三方依赖。结合 `React.memo` 与局部状态锁定，减少无意义的组件级联重绘。 |

<br />

## 0.1.0 架构纪元：Corona

Aurona Code V0.1.0 是一次里程碑式的底层技术跃迁。我们在该版本中引入了全新的 **Corona 架构** 规范，彻底解决了早期版本中的各种耦合与资源泄漏问题。

| 特性 | 详情描述 |
| :--- | :--- |
| **IPC 绝对隔离** | UI 表现层与后端 Tauri API（invoke/listen）彻底物理隔离，全面收拢至底层 `Foundation/IPC` 模块，极大增强系统的安全边界与可维护性。 |
| **极致沉浸视界** | 采用 Tailwind CSS v4 打造无边框、极致玻璃态（Glassmorphism）与光影折射的现代系统级界面，并配以极度平滑的自适应深浅模式切换。 |
| **Rust 进程守护** | 通过原子锁与 `Drop` 生命周期钩子守护 PTY 终端进程与 LSP 语言服务。杜绝僵尸进程，保证编辑器在意外退出时本地资源的绝对安全。 |
| **预加载与流式渲染** | 全新的事件总线与异步数据流让 Git 版本控制状态、海量文件树扫描做到毫秒级响应，彻底告别主线程阻塞卡顿。 |

<br />

## 技术栈基石

我们精挑细选了现代 Web 与系统编程领域最前沿、最高效的技术，为您打造丝滑的本地编码体验。

- **系统核心**: [Tauri v2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/)
- **渲染引擎**: [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **设计系统**: [Tailwind CSS v4](https://tailwindcss.com/)
- **编辑内核**: [Monaco Editor](https://microsoft.github.io/monaco-editor/) + 深度定制语言服务
- **终端生态**: [xterm.js](https://xtermjs.org/) + `portable-pty`

<br />

## 环境配置与运行指引

首次拉取代码后，我们推荐您使用项目内置的 `manager.py` 自动化管理脚本。

1. **环境准备**：请确保您的计算机已安装 [Node.js](https://nodejs.org/) 与 [Rust](https://www.rust-lang.org/) 环境。
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
   在根目录运行以下命令打开交互式面板，输入 `1` 即可启动开发服务器。
   ```bash
   python manager.py
   ```

<br />

## 参与社区贡献

我们热切欢迎并且期待您的 PR 与 Issue！在提交任何合并请求前，请务必阅读我们的 [文档目录](Docs) 中关于 Corona 架构和设计规范的要求。

> [!CAUTION]
> 发现安全漏洞时，请**绝对不要**在公共页面（如 Issue 区）中讨论。请严格按照 [安全策略](.github/SECURITY.md) 的流程进行私密报告，我们将第一时间予以响应。

<br />

---

<div align="center">
  <p>本项目受 <a href="LICENSE">GNU Affero General Public License v3.0</a> 许可证保护。</p>
  <p>Made with ❤️ by AuronaLabs</p>
</div>
