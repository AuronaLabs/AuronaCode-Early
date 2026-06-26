# 代码结构树 (Code Structure)

本文档映射了项目的核心目录架构。当前代码库基于 **Corona 架构**（0.1.0 引入）进行组织，以实现业务特性的隔离、底层 API 的安全封锁与基础能力的复用。

## 根目录概览

```text
AuronaCode/
 ├── .github/             # GitHub 社区标准与开源规范文件
 ├── Docs/                # 项目架构与设计文档
 ├── Src/                 # 前端 React 源代码 (核心)
 ├── src-tauri/           # Tauri 后端 Rust 源代码
 ├── index.html           # 前端挂载模板与初始加载屏
 ├── manager.py           # CLI 管理脚本 (环境检查、构建打包、配置同步)
 └── package.json         # 前端依赖配置
```

## Src 目录深度解析

```text
Src/
 ├── Foundation/          [最底层基建层]
 │    ├── IPC/            # -> Tauri 后端通信通道 (如 GitCommands, PtyCommands)
 │    ├── EventBus/       # -> 跨模块解耦通信的事件总线
 │    ├── Storage/        # -> 本地配置持久化 (如 UserConfigStore)
 │    └── Types/          # -> 核心共享类型
 │
 ├── Core/                [核心服务与守护单例]
 │    ├── AppBootstrapper.tsx # 启动加载前置检查
 │    ├── NotificationService.ts # 全局通知队列与派发中心
 │    ├── GitService.ts       # 异步 Git 状态抓取与缓存服务
 │    ├── TerminalService.ts  # 终端 PTY 的后台管理
 │    └── FileSystemService.ts# 文件操作的收口服务
 │
 ├── State/               [上下文级状态容器]
 │    ├── WorkspaceContext.tsx# 驱动整个编辑器窗口的顶层状态
 │    ├── EditorContext.tsx   # 当前焦点编辑器的状态与属性
 │    └── TerminalContext.tsx # 终端实例的集合状态
 │
 ├── Features/            [业务功能实体模块]
 │    ├── Editor/         # 代码编辑器引擎 (LSP 客户端、Monaco 集成、TabBar)
 │    ├── Explorer/       # 左侧文件树面板
 │    ├── Search/         # 跨文件文本搜索面板
 │    ├── SourceControl/  # Git 暂存与提交交互面板
 │    ├── Notifications/  # 侧边消息抽屉
 │    ├── Settings/       # 全局设置页面与更新历史面板
 │    └── Terminal/       # Xterm.js 交互式终端视图
 │
 ├── UI/                  [高复用的纯 UI 组件库]
 │    ├── Components/     # Button, Input, Modal, Select 等原子组件
 │    ├── Feedback/       # Toast, Tooltip 等弱交互反馈
 │    ├── Icons/          # 全局 SVG (Tabler) 资源注册
 │    └── Layouts/        # 页面级容器 (InternalPageLayout)
 │
 ├── Layout/              [应用骨架与排版层]
 │    ├── AppShell.tsx    # 全局外部框体 (活动栏、状态栏)
 │    ├── Workspace.tsx   # 工作区划分与视图分发器
 │    ├── ErrorBoundary.tsx
 │    └── TitleBar/       # 沉浸式拖拽条与命令栏
 │
 ├── App/                 [应用顶级入口]
 │    ├── App.tsx         # Context 注册
 │    ├── Main.tsx        # React 19 挂载
 │    └── Styles/         # Tailwind CSS 主题变量 (Theme.css)
 │
 └── Shared/              [泛用业务常量与工具]
      ├── Constants/      # 静态枚举字典 (RunConfig, Sidebar 等)
      ├── Types/          # 业务模型类型定义
      └── Utils/          # 无副作用的纯函数工具
```

## Corona 架构隔离原则

目前的目录结构设计遵循极度严格的安全与单向依赖原则：
- **`Features` (处理业务视图) 严禁调用 Tauri `invoke`**，必须通过 `Foundation/IPC` 或 `Core/Services`。
- **`UI` 层严禁包含任何业务逻辑**，只能负责接受 Props 与渲染样式。
- **`Core` 与 `Foundation` 严禁反向引入 `Features`**，以保证底层基础设施可以被独立剥离或测试。
