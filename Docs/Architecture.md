# 架构指南 (Architecture Guidelines)

Aurona Code 基于 Tauri、React、Tailwind CSS 和 Monaco Editor 构建 当前采用 Feature-Sliced Design 模式组织代码

## 核心架构原则

- **单向依赖**：业务特性模块 (`Features`) 可依赖底层 (`Core`) 和通用 UI (`UI`)，禁止逆向依赖
- **事件解耦**：跨模块通信统一通过 `EventBus` 中转
- **平台能力收口**：系统级 API（文件系统读写、进程调用）统一收口至 `Core` 层的相关服务（如 `FileSystemService`）

## 模块分层

### 1 App 层
应用入口与全局状态初始化
- `Main.tsx`：React 挂载点
- `App.tsx`：根路由与全局 Context
- `AppBootstrapper.tsx`：启动加载流程

### 2 Layout 层
负责页面骨架布局，不包含具体业务逻辑
- `AppShell.tsx`：主框架，包含标题栏、侧边栏容器与工作区容器
- `Workspace.tsx`：工作区管理器，负责编辑器与侧边面板的挂载

### 3 Features 层
独立的业务功能模块
- `Editor/`：Monaco Editor 封装与适配
- `Explorer/`：文件树目录渲染与基础操作
- `SourceControl/`：基于 Git 命令行的版本控制面板
- `Terminal/`：基于 xterm.js 与便携 PTY 的集成终端

### 4 UI 层
无业务副作用的纯表现组件
- `UI/Components/`：按钮、输入框、模态框等基础原子组件
- `UI/Feedback/`：Toast 提示、Tooltip 等

### 5 Core 层
底层基础设施与 Tauri API 封装
- `FileSystemService.ts`：文件系统交互
- `TerminalService.ts`：PTY 进程管理
- `StorageManager.ts`：本地配置持久化

### 6 Shared 层
跨模块复用的常量、类型与工具函数
