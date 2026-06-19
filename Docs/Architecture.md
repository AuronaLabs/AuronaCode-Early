# 架构指南 (Architecture Guidelines)

Aurona Code 是一个基于 Tauri、React、Tailwind CSS 和 Monaco Editor 的桌面代码编辑器。当前架构以 **Feature-Sliced Design** 为基础：业务能力按特性切片组织，底层能力沉到 `Core`，跨模块通信通过明确的中转层完成。

这份文档描述的是 V0.0.3 之后的代码形态。

## 核心原则

- **单向依赖**：`Features` 可以使用 `Core`、`Shared` 和 `UI`，但 `UI` 不反向依赖业务模块。
- **事件中转**：跨特性通信优先走 `EventBus`，编辑器状态统一走 `EditorAdapter`，避免把 Monaco 实例泄露到布局层。
- **桌面能力收口**：文件系统读写、路径处理、错误转义集中在 `FileSystemService`，不要在业务组件里直接散落 Tauri fs 调用。
- **可恢复体验**：文件树、Git 面板、标签页、未保存状态都应优先保证用户操作可预期，再考虑视觉表现。
- **响应式密度**：界面尺寸由 CSS 变量和 `data-density` 控制，避免只适配某一台机器的缩放比例。

## 分层结构

### 1. App 层

系统入口与启动初始化。

- `Src/App/Main.tsx`：React 挂载入口。
- `Src/App/App.tsx`：应用根组件。
- `Src/App/Styles/Theme.css`：主题 Token、布局尺寸、密度变量和基础样式。
- `Src/Core/AppBootstrapper.tsx`：启动阶段初始化、密度探测、启动状态文案和错误兜底。

### 2. Layout 层

负责应用骨架，不直接处理底层文件和 Git 细节。

- `AppShell.tsx`：组合标题栏、活动栏、侧边面板、工作区和底部状态栏。
- `Workspace.tsx`：管理标签页、活动标签、未保存关闭确认、文件重命名/删除后的标签同步。
- `TitleBar/TitleBar.tsx`：顶部菜单、窗口拖拽区和窗口控制。
- `ErrorBoundary.tsx`：React 渲染错误兜底。

### 3. Features 层

每个业务域独立维护自己的状态和渲染。

- `Editor/`：文件编辑、Monaco 引擎、编辑器状态中转。
- `Explorer/`：文件树、打开文件夹、创建、重命名、删除、刷新。
- `SourceControl/`：Git 状态读取、暂存、提交、会话缓存和后台刷新。
- `Settings/`：设置、关于、版本更新记录。
- `Notifications/`：通知面板。
- `Terminal/`：集成终端，处理 xterm.js 与后端 PTY 的双向通信及设备回显屏蔽。

### 4. UI 层

纯 UI 组件和反馈组件，不包含业务逻辑。

- `UI/Components/`：Button、Input、Modal、IconButton、ActivitySquare 等基础组件。
- `UI/Feedback/`：Toast、Tooltip 等全局反馈。
- `UI/Layouts/`：内置页面布局模板。

业务组件可以组合这些组件，但不要在 UI 层引入文件系统、Git 或编辑器业务。

### 5. Core 层

底层基础设施。

- `EventBus.ts`：应用内事件总线。
- `FileSystemService.ts`：文件系统服务，封装 Tauri fs 权限、读写、重命名、删除和错误提示。
- `TerminalService.ts`：终端后台服务，管理 PTY 进程 ID 与会话状态生命周期。
- `StorageManager.ts`：本地持久化封装。
- `Logger.ts`：日志工具。
- `AppBootstrapper.tsx`：启动流程与密度初始化。

### 6. Shared 层

跨业务共享的类型和纯函数。

- `Shared/Types/Tab.ts`：标签页类型定义。
- `Shared/Utils/LanguageUtils.ts`：根据文件名和扩展名推断 Monaco 语言。

## 关键通信链路

### 文件打开与保存

```text
Explorer / TitleBar
  -> EventBus.emit("app:open-file" | "app:save-file")
  -> Workspace / EditorTab
  -> FileSystemService
  -> MonacoEngine
```

保存成功后，`EditorTab` 更新本地快照并发出 `editor:dirty-changed`，`Workspace` 再同步标签页的未保存状态。

### 编辑器状态栏

```text
MonacoEngine
  -> EditorAdapter.bind()
  -> EditorAdapter.onStatusChange()
  -> AppShell status bar
```

底部状态栏不直接读取 Monaco 实例。当前行列、选择长度、语言、缩进、换行符和诊断数量都通过 `EditorAdapter` 中转。

### 文件树同步

```text
FileExplorer
  -> FileSystemService.renameEntry/deleteEntry
  -> EventBus.emit("file:renamed" | "file:deleted")
  -> Workspace updates opened tabs
```

重命名或删除已打开文件时，工作区会同步标签路径或关闭对应标签，避免出现幽灵标签。

### Git 面板缓存

```text
workspace:root-changed
  -> SourceControl reads session cache
  -> render cached status immediately
  -> background git refresh
  -> update cache and UI
```

后台刷新使用旋转图标表达状态，不使用显性文字打断面板扫描。

### 终端创建与生命周期

```text
TitleBar (Smart Run) / UI
  -> TerminalService.createTerminal()
  -> EventBus.emit("terminal:list-changed")
  -> Workspace renders new <TerminalView>
  -> TerminalView starts xterm.js and invokes spawn_pty
```

终端容器以 `display: none` 隐藏而非直接卸载，保证 PTY 进程与前端渲染上下文不被意外清理。

## 版本说明

V0.0.3 的重点是引入**全景控制台体验**与**原生终端整合**，补齐文件操作工作流，解决各类乱码和性能延迟问题，并初步对齐 Mira 设计系统的 UI 视觉标准。
