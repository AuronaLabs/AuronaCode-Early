# 代码结构树与功能解析 (Code Structure & Tree-Sitter)

本文档映射了整个 `Src` 目录的架构。
每一个文件夹都是严格按照 **特性切片 (Feature-Sliced Design)** 进行划分的，**绝对没有重复、冗余或无用的文件夹**。通过这种极度解耦的方式，任何模块出问题都不会波及到其他模块。

## 🌲 Src 目录概览

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
 ├── Features/            [独立业务特性域 - 最核心的代码]
 │    ├── Editor/         # -> 代码编辑模块
 │    │    ├── EditorTab.tsx     # 负责读取文件并挂载引擎
 │    │    ├── IEditorEngine.ts  # 编辑器引擎的标准接口规范
 │    │    ├── EditorAdapter.ts  # 桥接业务与 Monaco 的适配器
 │    │    └── MonacoEngine.tsx  # 微软 Monaco Editor 的底层配置与初始化
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
 │    ├── Components/     # -> 原子级组件 (曾经的 Mira 库)
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
 │         └── InternalPageLayout.tsx # 所有内置独立页面(如关于、设置)的通用滚动框架
 │
 ├── Core/                [底层基础设施]
 │    ├── AppBootstrapper.tsx # 负责应用启动前的初始化与依赖自检
 │    ├── EventBus.ts         # 🔥 全局事件总线，负责各大独立模块间的通信
 │    ├── FileSystemService.ts# 文件系统操作封装 (Tauri fs 调用收口)
 │    ├── Logger.ts           # 本地化日志记录器
 │    ├── StorageManager.ts   # 浏览器/本地持久化缓存封装
 │    └── TerminalService.ts  # 终端后台服务 (PTY 会话生命周期与列表管理)
 │
 └── Shared/              [泛用共享资源]
      ├── Types/          
      │    └── Tab.ts         # 定义应用内标签页 (Tab) 的数据结构与枚举类型
      └── Utils/          
           └── LanguageUtils.ts # 根据文件扩展名推断编程语言的高频工具函数
```

## 🔍 架构思考 (The "Tree-Sitter" View)

为什么要分这么多文件夹？
如果你把上述所有代码都混在一个 `Components` 里，那么修改按钮样式时可能会不小心打断 Git 提交逻辑；添加一个设置页面可能会导致文件树崩溃。

目前的结构是**单向数据流**的：
`Features` (处理业务) -> 依赖 -> `UI` (渲染视图) 和 `Core` (触发事件)。
绝不存在 `UI` 反向去导入 `Features` 中的逻辑。这种解耦方式保证了项目可以无限制地平行扩展下去，这就是目前能做到的最完美的工程结构。
