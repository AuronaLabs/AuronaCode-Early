# Aurona Code 架构

本文档描述 0.3.0 当前仓库已经实现的边界、状态所有权和关键数据流。标为“尚未完成”的内容不是已交付能力。

## 1. 运行时分层

```text
App / Layout / Features
        │
        ├── useWorkbenchStore / editorStore / terminalStore
        ├── CommandRegistry
        ├── Core domain services
        └── EditorIPC projection queue
        │
Foundation/Desktop + Foundation/IPC
        │
        ├── typed commands
        ├── typed events
        └── DesktopError
        │
Tauri 2 / Rust
        ├── editor / Rope / persistence
        ├── filesystem / search / Git
        ├── PTY / LSP
        └── updater / performance
```

总体原则是：React 负责界面组合和短期交互，Zustand 负责长期前端状态，Core 负责用例协调，Foundation 负责桌面传输，Rust 负责本地资源和持久文档权威。

## 2. 应用启动与生命周期

1. `Src/App/Main.tsx` 挂载 React 主入口。
2. `AppBootstrapper` 在 React 生命周期中调用 `AppServices.start()`。
3. `AppServices` 启动工作台、编辑器与终端 store 的持久化和桌面监听。
4. 应用卸载时调用 `dispose()`，注销窗口、Tauri、EventBus 监听和后台资源。
5. Splash 使用独立入口与最小 CSS；主窗口可交互后关闭启动窗口。

模块加载本身不应静默启动 shell 探测、更新器、终端或 LSP。需要本地资源的服务应在生命周期或首次使用时显式启动。

## 3. 状态所有权

| 状态 | 唯一可写源 | 读取方 |
| --- | --- | --- |
| 标签页、活动标签、侧边栏、底部面板、待关闭项、文件定位请求 | `useWorkbenchStore` | AppShell、Workspace、TitleBar、Explorer |
| Rust 文档文本、revision、saved revision、磁盘指纹 | Rust `EditorState` / Rope session | EditorIPC |
| 前端文本投影、选择、输入与操作历史 | 活动 AuronaEngine + EditorIPC 队列 | 编辑器 DOM、状态栏 |
| 终端展示元数据 | `useTerminalStore` | TerminalView、Workspace |
| PTY/LSP 子进程 | Rust 进程管理器 | 类型化事件适配器 |
| 用户配置与工作区持久化 | `UserConfigStore` / `WorkspaceStore` | Settings、AppServices |
| Toast、导航意图等短暂事件 | EventBus | 对应 UI 订阅者 |

React 本地 state 只适合输入框、弹层开关、hover 和单次请求等短生命周期数据。EventBus 不保存标签、文档或终端业务事实。

## 4. 桌面边界与 IPC

`Src/Foundation/Desktop` 是前端唯一允许导入 `@tauri-apps/*` 的目录。`scripts/check-desktop-boundaries.mjs` 在本地和 CI 中静态阻止业务模块绕过该边界。

边界职责包括：

- 将 `invoke`、`listen` 和插件对象转换为类型化函数与普通 DTO。
- 统一返回 `DesktopError { domain, code, message, recoverable, cause }`。
- 只负责传输和错误归一化，不自动决定 Toast、弹窗或局部错误 UI。
- 为窗口、对话框、文件系统、macOS 菜单和更新器提供领域适配。
- PTY 高频事件仍走直连事件通道，但必须通过可注销的类型化监听器。

Tauri capability 分为 `main.json` 和 `splash.json`。这降低了启动窗口权限，但不等于已经实现工作区文件系统沙箱。

## 5. 编辑器数据流

### 打开

1. `EditorTab` 调用 `EditorIPC.open(path)`。
2. Rust 创建或复用 Rope 会话并返回包含 revision、语言、行尾和磁盘指纹的快照。
3. AuronaEngine 建立前端投影、选择和历史状态。

### 编辑

```text
keyboard / IME / paste
        │
optimistic frontend projection
        │
operation history + one in-flight batch per document
        │
apply_editor_edits(baseRevision, clientBatchId, edits)
        │
clone Rope -> sequential edits -> atomic session commit
        │
revision acknowledgement or conflict
```

一批编辑只增加一次 revision。Rust 在克隆 Rope 上完成整批操作，任何编辑失败都不会提交半批状态。前端冲突时保留本地投影并停止覆盖式保存。

### 保存与恢复

- 保存同时校验前端 base revision 和磁盘指纹。
- Rust 写入临时文件、同步落盘、保留权限，再替换目标文件。
- 脏文档每次内容变化都会重新 debounce 本地恢复快照；同一文档串行写入，窗口关闭前由 AppServices 强制刷新。
- 保存以发起时的前端文本 checkpoint 为准；保存期间出现新输入时仍保持 dirty 并保留最新恢复快照。
- 当前具备保存前外部变化保护，但尚未实现覆盖所有文档的实时文件监听和完整冲突 UI。

### 渲染与异步结果

- 普通文档使用 highlight.js Worker；大文件保留 Rust 高亮与分段行读取路径。
- 编辑器使用虚拟视口，不为统一架构退回整文件 DOM 渲染。
- 文档打开与前端文本投影仍为全量协议，因此 0.3.0 在创建 Rope 前执行 32 MiB 安全上限检查；真正的分页可编辑会话尚未实现。
- 搜索和部分异步路径使用 request ID 丢弃过期结果。
- LSP、Worker、诊断和全部搜索结果尚未完全统一到同一 revision 协议。

## 6. 命令与用户操作

`Extension/CommandRegistry.ts` 定义命令 ID、标题、上下文、快捷键与执行器。标题栏菜单、macOS 菜单、Fliuno 和编辑快捷键调用相同命令，而不是各自复制业务逻辑。Fliuno 是全局搜索界面，当前首先接入命令数据源。

`Extension` 目录当前不是插件运行时。仓库没有插件沙箱、市场、扩展 API 或 VS Code 兼容层。

## 7. Rust 模块职责

| 模块 | 职责 |
| --- | --- |
| `editor.rs` | Rope 会话、UTF-16、revision、原子批量编辑、高亮与持久化 |
| `commands/fs.rs` | 工作区文件系统 commands |
| `search.rs` | 工作区搜索、request ID、取消标记与资源清理 |
| `commands/git.rs` | Git 输入校验与 `spawn_blocking` 调度 |
| `pty.rs` | PTY 创建、输入、尺寸、退出与回收 |
| `lsp.rs` / `lsp_cmds.rs` | 统一文件 URI、LSP 请求与事件 |
| `process_tree.rs` | Windows Job Object 与 LSP 子进程树回收 |
| `performance.rs` | 本地性能工作负载、样本与取消 |
| `lib.rs` | Tauri 插件、窗口生命周期和 command 注册 |

## 8. UI 与 Material 系统

- `Theme.css` 定义 Canvas、Chrome、Panel、Surface、Overlay、Modal、Interactive 语义材质。
- `GlassManager` 管理深浅主题独立的 light/medium/heavy 拟物档位。
- `UI/Components` 提供 Button、Input、Switch、Select、菜单、Modal 和 GlassList 等复用组件。
- 业务状态颜色（Git addition/deletion、错误、警告）不替代容器材质层级。
- 键盘焦点必须可见；输入框由外层玻璃组件呈现焦点，避免双层蓝框。

## 9. 质量门禁

- TypeScript：`pnpm run typecheck`
- Biome：`pnpm run check`
- 桌面边界：`pnpm run check:boundaries`
- Material 边界：`pnpm run check:materials`
- 发布元数据：`pnpm run smoke`
- 前端测试：Vitest + React Testing Library
- Rust：fmt、clippy、check、test
- CI：前端 Ubuntu job + Windows/macOS/Linux Rust matrix

## 10. 尚未完成的架构事项

- AuronaEngine 仍是较大的组合与 DOM 渲染层，尚未完成全部渐进拆分。
- 仅活动编辑器完整挂载与最多 6 个干净投影的 LRU 尚未实现。
- 完整外部文件监听、统一冲突处理和全量异步 revision 失效尚未完成。
- 插件运行时、AI Command Center、云服务和遥测不属于 0.3.0。

这些事项应在真实测试和数据安全门禁下渐进演进，不应通过全仓重写一次性处理。
