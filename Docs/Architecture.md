# 架构指南 (Architecture Guidelines)

Aurona Code 当前已步入 0.1.0 时代，采用高度严格的 **Corona 架构** 模式组织代码。该架构的首要目标是：**安全隔离、职责收敛、绝对解耦**。

## 核心架构原则 (Corona 原则)

1. **IPC 绝对隔离**：前端业务组件（React）**严禁**直接调用 Tauri 的 `invoke` 或 `listen`。所有后端交互必须被封装在 `Foundation/IPC` 模块内。
2. **事件总线驱动**：跨模块（或跨组件级别）的通信，应通过统一的全局 `EventBus` 派发和监听事件，避免深层 Props 透传和模块之间的直接依赖。
3. **单向依赖流**：`Features`（业务模块）可以依赖 `Core`（核心服务）与 `UI`（基础组件），但底层服务严禁逆向依赖业务逻辑层，保证底层的纯净与高复用性。
4. **Rust 后端内存安全**：所有常驻进程（如 LSP、PTY 终端）在 Rust 侧必须实现 `Drop` 生命周期，保证在 Tauri 前端销毁或刷新时，后台幽灵进程会被立即安全回收。

## 前端模块分层 (Src/)

### 1. Foundation 层 (基建层)
处于整个系统最底层，为上层提供纯粹的接口或工具支持。
- `IPC/`：封装所有与 Tauri 通信的端点（如 `GitIPC.ts`, `PtyIPC.ts`）。
- `Types/`：存放全项目复用的核心数据结构类型（如 `Config.ts`、`Tab.ts`）。
- `EventBus/`：纯正的 Pub-Sub 事件总线引擎，用于应用内的跨组件通信。

### 2. Core 层 (核心服务层)
负责承载单例状态、全局通信逻辑、系统级业务封装。
- `StorageManager.ts`：本地配置的序列化与持久化交互。
- `NotificationService.ts`：应用全局通知流管理器，消费系统事件。
- `GitService.ts`：抽象出 Git 状态的异步拉取和内存缓存机制。

### 3. Features 层 (功能业务层)
各自独立、自洽的业务拼图组合模块。
- `Editor/`：包含代码编辑器界面、Aurona Editor 引擎适配与 LSP 客户端（`LspClient`）。
- `Explorer/`：文件树渲染引擎。
- `SourceControl/`：利用 `GitService` 封装的 Git 追踪控制面板。
- `Terminal/`：终端视图控制器，通过 `PtyIPC` 获取输入输出流。
- `Notifications/`：全局消息抽屉展现。

### 4. Layout 层 (骨架布局层)
负责划分屏幕的结构骨架。
- `AppShell.tsx`：包裹所有导航侧边栏、状态栏和标题栏的外壳。
- `Workspace.tsx`：中央舞台区域的渲染中心。

### 5. UI 层 (基础表现层)
无任何业务副作用、无后端的纯视觉组件。
- `Components/`：如 `Button`、`Input`、`Select` 等极简交互组件。
- `Feedback/`：`Toast`、`Tooltip` 等弱交互反馈组件。
- `Layouts/`：如 `InternalPageLayout`。

## Tauri 后端架构 (src-tauri)

后端职责被极限压缩至：**系统接口桥接** 与 **高并发守护**。
- `pty.rs`：终端进程（伪终端）的生命周期管理与读写通道。
- `lsp.rs`：语言服务进程（LSP Server）的长连接与异步超时管理。
- `lib.rs`：无状态命令行执行（如 Git 封装）、Tauri Commands 的统一导出。
