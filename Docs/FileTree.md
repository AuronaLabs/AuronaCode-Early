# 代码结构树 (Code Structure)

本文档映射了项目的核心目录架构。当前代码库基于 **Corona+ 架构** 进行组织，全面采用了 React 19 和无头组件分离思想，为即将到来的 APE（Aurona Plugin Engine）做足准备。

## 根目录概览

```text
AuronaCode/
 ├── .github/             # GitHub Actions 自动化产物分发与持续集成
 ├── Docs/                # 项目架构与设计文档
 ├── Src/                 # 前端 React 源代码 (核心)
 ├── src-tauri/           # Tauri V2 后端 Rust 源代码与打包配置
 ├── index.html           # 前端挂载模板与初始加载屏
 ├── manager.py           # CLI 管理脚本 (环境检查、构建打包、配置同步)
 └── package.json         # 前端依赖配置
```

## Src 目录深度解析

```text
Src/
 ├── Foundation/          [最底层基建层]
 │    ├── IPC/            # -> Tauri 后端强类型通信通道 (如 GitIPC.ts)
 │    ├── EventBus/       # -> 跨模块解耦通信的事件总线中心
 │    └── Types/          # -> 核心共享类型与通用接口
 │
 ├── Core/                [核心服务与守护单例]
 │    ├── AppBootstrapper.tsx # 启动加载前置检查与全局资源初始化
 │    ├── NotificationService.ts # 全局通知队列与派发中心
 │    ├── StorageManager.ts   # Tauri FS 持久化抽象代理
 │    └── GitService.ts       # 异步 Git 状态抓取与缓存服务
 │
 ├── State/               [上下文级状态容器]
 │    ├── WorkspaceContext.tsx# 驱动整个工作区窗口的顶层状态
 │    ├── EditorContext.tsx   # 当前焦点编辑器的状态与属性
 │    └── TerminalContext.tsx # 终端实例的集合状态
 │
 ├── Features/            [业务功能实体模块]
 │    ├── Editor/         # 核心代码编辑器引擎 (AuronaEditor)
 │    ├── Explorer/       # 左侧文件系统树与上下文面板
 │    ├── Search/         # 跨文件文本搜索面板
 │    ├── SourceControl/  # Git 暂存、提交与历史流交互面板
 │    ├── Notifications/  # 侧边消息抽屉
 │    ├── Settings/       # 全局设置页面与存储管理器
 │    │    └── ChangelogData.ts # 版本更新日志记录数据库
 │    └── Terminal/       # Xterm.js 交互式虚拟终端视图
 │
 ├── UI/                  [高复用的极客 UI 组件库]
 │    ├── Components/     # Button, Input, Modal, Select (基于 Radix UI)
 │    ├── Feedback/       # Toast, Tooltip 等弱交互反馈
 │    ├── Icons/          # 基于 Tabler Icons 的全局 SVG 资源注册表
 │    └── Layouts/        # 页面级容器结构
 │
 ├── Layout/              [应用骨架与排版层]
 │    ├── AppShell.tsx    # 全局外部框体 (活动栏、状态栏)
 │    ├── Workspace.tsx   # 中央舞台的工作区视图分发器
 │    ├── ErrorBoundary.tsx # 全局 React 崩溃边界拦截
 │    └── TitleBar/       # 沉浸式拖拽条与命令栏 (支持 macOS 原生映射支持)
 │
 ├── App/                 [应用顶级入口]
 │    ├── App.tsx         # Context 注册与路由分发
 │    ├── Main.tsx        # React 19 StrictMode 挂载
 │    └── Styles/         # Tailwind CSS V4 主题变量 (Theme.css)
 │
 └── Shared/              [泛用业务常量与工具]
      ├── Constants/      # 静态枚举字典
      └── Utils/          # 无副作用的纯函数工具库
```

## Corona+ 架构隔离原则

目前的目录结构设计遵循极度严格的安全与单向依赖原则：
- **`Features` (处理业务视图) 严禁直接调用 Tauri 原生通信 API**，必须通过 `Foundation/IPC` 或 `Core/Services` 转发。这是为了插件沙盒引擎 (APE) 而设下的严格权限门禁。
- **`UI` 层严禁包含任何特定业务逻辑**，只能负责接受 Props 与渲染样式。
- **`Core` 与 `Foundation` 严禁反向引入 `Features`**，以保证底层基础设施可以被独立剥离或测试。
