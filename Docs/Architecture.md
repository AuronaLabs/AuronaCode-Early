# 架构指南 (Architecture Guidelines)

Aurona Code 现已步入 **Corona+ 架构** 时代。该架构的首要目标是：**安全隔离、极致渲染、开放兼容**。在保持 Tauri V2 与 Rust 底层的高性能的同时，通过 React 19 和 Radix UI 实现了极致的无头无障碍 UI 交互，并为即将到来的 APE (Aurona Plugin Engine) 插件生态做好沙盒准备。

## 核心架构原则 (Corona+ 原则)

1. **IPC 绝对隔离与权限守卫**：前端业务组件（React）**严禁**直接调用全局 `invoke`。所有的后端交互必须通过 `Foundation/IPC` 模块的强类型包装。未来 APE 插件的通信将完全由 APE 代理拦截，保障沙盒隔离。
2. **事件总线驱动**：跨模块通信统一使用全局 `EventBus`，避免深层 Props 透传和模块硬耦合。
3. **单向依赖流**：`Features`（业务模块）可以依赖 `Core`（核心服务）与 `UI`（基础组件），但底层服务严禁逆向依赖业务层。
4. **Rust 后端内存安全与跨平台映射**：Rust 层负责核心守护（LSP、PTY），严格管理 `Drop` 生命周期。引入了原生的跨平台特性支持，如 macOS 的系统顶部菜单栏原生映射。

## 前端模块分层 (Src/)

### 1. Foundation 层 (基建层)
处于整个系统最底层，提供基石级服务。
- `IPC/`：封装所有与 Tauri 通信的端点（`get_app_data_size`, `open_devtools` 等）。
- `Types/`：存放全项目复用的核心数据结构（如 `Config.ts`）。
- `EventBus/`：Pub-Sub 事件引擎，支撑多插件与组件间的消息流动。

### 2. Core 层 (核心服务层)
负责承载单例状态、系统级业务封装。
- `StorageManager.ts`：负责跨环境存储与读取。
- `NotificationService.ts`：全局系统事件的消费。
- `GitService.ts`：抽象异步 Git 操作和内存缓存。

### 3. Features 层 (功能业务层)
基于 Corona+ 原则开发的业务拼图，可随时插拔。
- `Editor/`：包含 AuronaEditor 代码编辑器引擎与 LSP 客户端抽象。
- `Explorer/`：文件树渲染引擎。
- `Settings/`：支持动态存储读取的全局设置面板。
- `Terminal/`：Xterm.js 终端视图控制器。

### 4. Layout 层 (骨架布局层)
- `AppShell.tsx`：统管导航侧边栏、状态栏和全局上下文。
- `Workspace.tsx`：中央舞台区域的视图分发。

### 5. UI 层 (基础表现层)
- `Components/`：全面整合 Radix UI 无头组件库打造，提供键盘无障碍与极致交互的原子组件。
- `Icons/`：基于 Tabler Icons 统一管理的纯净 SVG 资源。

## Tauri 后端架构 (src-tauri)

后端职责被精简为：**系统接口桥接**、**系统资源探测** 与 **高并发守护**。
- `pty.rs` / `lsp.rs`：异步终端与语言服务进程管理。
- `ipc.rs`：扩展系统级能力，如递归获取文件目录大小等原生高效率操作。
- `main.rs` / `lib.rs`：配置跨平台特性与无状态 Tauri Commands 统一导出。
