# 代码结构树 (Code Structure)

本文档映射了项目的核心目录架构 当前代码库基于 Feature-Sliced Design 进行组织，以实现业务特性的隔离与底层能力的复用

## 根目录概览

```text
AuronaCode/
 ├── .github/             # GitHub 社区标准与开源规范文件
 │    ├── CODE_OF_CONDUCT.md
 │    ├── CONTRIBUTING.md
 │    ├── FUNDING.yml
 │    ├── ISSUE_TEMPLATE/
 │    ├── PULL_REQUEST_TEMPLATE.md
 │    ├── SECURITY.md
 │    └── SUPPORT.md
 │
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
 ├── App/                 [应用顶层入口]
 │    ├── App.tsx         # React 渲染根节点，提供全局状态包裹
 │    ├── Main.tsx        # Vite 挂载入口
 │    └── Styles/         
 │         └── Theme.css  # 全局样式配置与 Tailwind 主题变量
 │
 ├── Layout/              [宏观布局排版层]
 │    ├── AppShell.tsx    # 全局骨架：渲染左侧活动栏、底部状态栏，分配主工作区
 │    ├── Workspace.tsx   # 工作区逻辑：管理多标签页(Tabs)系统与卡片组
 │    ├── ErrorBoundary.tsx # React 全局错误捕捉边界
 │    └── TitleBar/       # 自定义系统标题栏
 │         ├── TitleBar.tsx      # 拖拽区与窗口操作按钮
 │         └── TopCommandBar.tsx # 顶部居中的快捷指令条
 │
 ├── Features/            [独立业务特性域]
 │    ├── Editor/         # -> 代码编辑模块
 │    │    ├── EditorTab.tsx     # 负责读取文件并挂载引擎
 │    │    ├── IEditorEngine.ts  # 编辑器引擎的标准接口规范
 │    │    ├── EditorAdapter.ts  # 桥接业务与 Monaco 的适配器
 │    │    └── MonacoEngine.tsx  # Monaco Editor 的底层配置与渲染
 │    │
 │    ├── Explorer/       # -> 资源管理模块
 │    │    └── FileExplorer.tsx  # 渲染左侧文件树，处理增删改查交互
 │    │
 │    ├── Notifications/  # -> 通知中心模块
 │    │    └── NotificationsPanel.tsx # 侧边栏消息中心组件
 │    │
 │    ├── Settings/       # -> 系统与偏好设置模块
 │    │    ├── AboutTab.tsx      # “关于”页面
 │    │    ├── ChangelogTab.tsx  # “更新日志”页面
 │    │    ├── SettingsTab.tsx   # 主设置页面
 │    │    └── ChangelogData.ts  # 存储具体的更新历史数据
 │    │
 │    ├── SourceControl/  # -> Git 版本控制模块
 │    │    ├── SourceControl.tsx # 渲染左侧 Git 面板（暂存、提交操作）
 │    │    └── GitSettingsTab.tsx# Git 高级配置面板 (填写 Remote 等)
 │    │
 │    └── Terminal/       # -> 终端控制模块
 │         └── TerminalView.tsx  # 渲染集成终端 (xterm.js) 与 PTY 通信
 │
 ├── UI/                  [纯净的基础 UI 组件系统]
 │    ├── Components/     # -> 原子级组件
 │    │    ├── ActivitySquare.tsx # 左侧导航栏的正方形小图标
 │    │    ├── Button.tsx         # 通用按钮
 │    │    ├── Card.tsx           # 通用圆角卡片面板
 │    │    ├── IconButton.tsx     # 图标按钮
 │    │    ├── Input.tsx          # 统一的输入框
 │    │    └── Modal.tsx          # 弹出层/模态框
 │    │
 │    ├── Feedback/       # -> 全局反馈组件
 │    │    ├── Toast.tsx          # 右上角滑出的轻提示
 │    │    └── Tooltip.tsx        # 鼠标悬停提示
 │    │
 │    ├── Icons/          # -> 纯 UI 图标库
 │    │    └── IconManager.tsx    # 全局 SVG 图标统一注册与分发中心
 │    │
 │    └── Layouts/        # -> 页面级别的布局模板
 │         └── InternalPageLayout.tsx # 内置独立页面的通用滚动框架
 │
 ├── Core/                [底层基础设施]
 │    ├── AppBootstrapper.tsx # 负责应用启动前的初始化与依赖自检
 │    ├── EventBus.ts         # 全局事件总线，负责独立模块间的解耦通信
 │    ├── FileSystemService.ts# 文件系统操作封装 (Tauri fs 调用收口)
 │    ├── Logger.ts           # 本地化日志记录器
 │    ├── MonacoSetup.ts      # Monaco Editor 的全局 worker 预配置与挂载
 │    ├── StorageManager.ts   # 本地持久化缓存封装
 │    └── TerminalService.ts  # 终端后台服务 (PTY 会话生命周期与列表管理)
 │
 └── Shared/              [泛用共享资源]
      ├── Types/          
      │    └── Tab.ts         # 定义应用内标签页的数据结构与枚举
      └── Utils/          
           └── LanguageUtils.ts # 根据文件扩展名推断编程语言的高频工具函数
```

## 架构隔离原则

目前的目录结构设计遵循单向数据流原则：
`Features` (处理业务逻辑与状态) -> 依赖 -> `UI` (渲染无状态视图) 和 `Core` (触发事件与系统 API)
`UI` 层与 `Core` 层严禁反向引入 `Features` 中的特化业务逻辑，以此保证基础能力的纯粹性与项目架构的可平行扩展能力
