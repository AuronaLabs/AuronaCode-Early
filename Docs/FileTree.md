# Aurona Code 文件树

本文档以 0.3.0 当前仓库为准，展示长期维护时需要理解的目录、关键文件和职责。构建产物、依赖目录和批量图标资源未逐项展开。

```text
Aurona Code/
├─ .github/
│  ├─ ISSUE_TEMPLATE/                 # 缺陷、功能建议与安全入口
│  ├─ workflows/
│  │  ├─ quality.yml                  # PR/main 前端与三平台 Rust 门禁
│  │  └─ release.yml                  # tag 驱动的多平台 Tauri Release
│  ├─ CONTRIBUTING.md                 # 贡献与本地验证指南
│  ├─ PULL_REQUEST_TEMPLATE.md        # PR 范围、测试和风险清单
│  ├─ SECURITY.md                     # 支持版本与私密披露流程
│  └─ SUPPORT.md                      # 用户支持入口
├─ Docs/
│  ├─ Architecture.md                 # 运行时边界、状态所有权和数据流
│  ├─ FileTree.md                     # 当前文件
│  ├─ DesignPrinciples.md              # Aurona Material 设计原则
│  ├─ ProductVision.md                 # 产品方向、现状与未来边界
│  ├─ 0.3.0-Execution-Plan.md          # 0.3.0 阶段执行记录
│  ├─ 0.3.0-TechnicalNotes.md          # 已完成和明确未完成事项
│  ├─ 0.3.0-Performance-Report.md      # 基准方法、产物体积与待测项
│  └─ 0.3.0-Release-Notes.md           # 对外版本说明
├─ public/
│  ├─ logo.png                         # 品牌 Logo
│  └─ splash.webp                      # 启动页图像资源
├─ scripts/
│  ├─ check-desktop-boundaries.mjs     # 禁止业务层直接导入 Tauri
│  ├─ extract-changelog.ts             # 从应用更新历史生成 Release Body
│  └─ smoke.mjs                        # 版本和更新历史一致性检查
├─ Src/
│  ├─ App/
│  │  ├─ App.tsx                       # 主 React 应用入口
│  │  ├─ Main.tsx                      # DOM 挂载入口
│  │  ├─ Splash.tsx                    # 独立启动窗口入口
│  │  └─ Styles/
│  │     ├─ Theme.css                  # Material tokens、主题与全局样式
│  │     └─ Splash.css                 # 不依赖主主题的最小启动页样式
│  ├─ Core/
│  │  ├─ AppBootstrapper.tsx           # React 生命周期与应用服务桥接
│  │  ├─ AppServices.ts                # start/dispose 和监听器所有权
│  │  ├─ Commands.ts                   # 应用命令注册与处理器
│  │  ├─ FileSystemService.ts          # 文件领域服务
│  │  ├─ GitService.ts                 # Git 领域服务
│  │  ├─ TerminalService.ts            # 终端服务生命周期
│  │  └─ UpdaterService.ts             # 更新检查、下载与安装协调
│  ├─ Extension/
│  │  └─ CommandRegistry.ts            # 命令定义、上下文和快捷键；非插件运行时
│  ├─ Features/
│  │  ├─ Editor/
│  │  │  ├─ AuronaEngine.tsx           # 编辑器组合与 DOM 渲染层
│  │  │  ├─ EditorTab.tsx              # 文档会话与标签内容入口
│  │  │  ├─ EditorTabBar.tsx           # 标签栏交互
│  │  │  ├─ EditorAdapter.ts           # 活动编辑器只读门面
│  │  │  ├─ IEditorEngine.ts           # 编辑器公开接口
│  │  │  ├─ LspClient.ts               # LSP 前端适配
│  │  │  ├─ Hooks/                     # 选择与操作历史
│  │  │  ├─ Model/RecoveryStore.ts      # 恢复快照持久化
│  │  │  ├─ Model/RecoveryCoordinator.ts# debounce、串行写入与关闭前刷新
│  │  │  ├─ Utils/                     # UTF-16、测量等纯工具
│  │  │  ├─ Workers/highlight.worker.ts# 语法高亮 Worker
│  │  │  └─ components/                # 补全、搜索和渲染行组件
│  │  ├─ Explorer/                     # 文件树、节点操作和定位
│  │  ├─ Search/SearchPanel.tsx         # 全局搜索、取消与结果列表
│  │  ├─ SourceControl/
│  │  │  ├─ SourceControl.tsx           # Git 状态、暂存、提交与历史
│  │  │  └─ DiffViewer.tsx              # 提交差异玻璃视图
│  │  ├─ Terminal/TerminalView.tsx      # xterm.js 终端视图
│  │  ├─ Settings/                     # 设置、关于、更新历史和性能测试
│  │  ├─ Notifications/                # 通知面板
│  │  └─ Plugins/                      # 未实现插件能力的说明页面
│  ├─ Foundation/
│  │  ├─ Desktop/                      # 唯一允许导入 @tauri-apps/* 的边界
│  │  │  ├─ Transport.ts               # 类型化 invoke/listen 与 DesktopError
│  │  │  ├─ AppWindow.ts               # 窗口和桌面事件
│  │  │  ├─ Dialog.ts                  # 原生对话框 DTO
│  │  │  ├─ FileSystem.ts              # Tauri 文件系统适配
│  │  │  ├─ MacMenu.ts                 # macOS 原生菜单桥接
│  │  │  └─ Updater.ts                 # Updater 插件 DTO 边界
│  │  ├─ IPC/                          # Editor、Git、PTY 领域客户端
│  │  ├─ EventBus/                     # 短生命周期 UI 通知
│  │  ├─ Logger/                       # 前端日志门面
│  │  ├─ Storage/                      # 用户配置和工作区持久化
│  │  └─ Types/                        # 编辑器、标签、终端共享类型
│  ├─ Layout/
│  │  ├─ AppShell.tsx                  # 桌面 Shell 布局
│  │  ├─ Workspace.tsx                 # 活动区、侧边栏和面板组合
│  │  ├─ TitleBar/TitleBar.tsx          # 自定义标题栏与菜单
│  │  ├─ StatusBar.tsx                 # 编辑器状态栏
│  │  └─ ErrorBoundary.tsx             # 致命渲染错误边界
│  ├─ State/
│  │  ├─ useWorkspaceStore.ts           # Workbench 长期状态唯一写源
│  │  ├─ useEditorStore.ts              # 编辑器派生状态
│  │  └─ useTerminalStore.ts            # 终端展示状态
│  ├─ UI/
│  │  ├─ Components/                   # Button、Input、Switch、菜单、玻璃列表等
│  │  ├─ Core/GlassManager/            # 拟物档位、材质变体和 GlassContainer
│  │  ├─ Feedback/                     # Toast、Tooltip、UpdateModal
│  │  ├─ Icons/IconManager.tsx          # 统一图标入口
│  │  └─ Layouts/                      # 共享内部页面布局
│  ├─ Shared/                          # 常量、轻量类型和通用工具
│  └─ Test/setup.ts                    # Vitest/Testing Library 初始化
├─ src-tauri/
│  ├─ bindings/                        # Rust 导出的 TypeScript DTO
│  ├─ capabilities/
│  │  ├─ main.json                     # 主窗口最小权限
│  │  └─ splash.json                   # 启动窗口最小权限
│  ├─ icons/                           # 桌面安装包图标资源
│  ├─ src/
│  │  ├─ commands/
│  │  │  ├─ fs.rs                      # 文件系统 commands
│  │  │  ├─ git.rs                     # Git commands 与输入校验
│  │  │  ├─ ipc.rs                     # 通用 IPC 与应用能力
│  │  │  ├─ lsp_cmds.rs                # LSP commands
│  │  │  └─ utils.rs                   # command 共用工具
│  │  ├─ editor.rs                     # Rope 会话、revision、编辑与原子保存
│  │  ├─ search.rs                     # 工作区搜索、request ID 与取消
│  │  ├─ pty.rs                        # PTY 进程和事件
│  │  ├─ lsp.rs                        # LSP 子进程和事件
│  │  ├─ process_tree.rs               # Windows Job Object 进程树生命周期
│  │  ├─ performance.rs                # 性能工作负载与资源清理
│  │  ├─ lib.rs                        # Tauri Builder、插件和 command 注册
│  │  └─ main.rs                       # 桌面二进制入口
│  ├─ Cargo.toml
│  ├─ Cargo.lock
│  └─ tauri.conf.json                  # 窗口、CSP、更新器和打包配置
├─ manager.py                          # 可选 Rich 交互式开发管理器
├─ package.json                        # pnpm 脚本和前端依赖
├─ pnpm-lock.yaml                      # 冻结依赖锁
├─ vite.config.ts
├─ vitest.config.ts
├─ biome.json
├─ tsconfig.json
└─ README.md
```

## 依赖方向

```text
App / Layout / Features
        ├── State
        ├── UI
        ├── Core services
        └── Foundation IPC/Desktop
                    │
                    ▼
              Tauri / Rust
```

- `Features` 可以组合 `UI` 和领域服务；`UI` 不应反向依赖编辑器、Git 或工作区业务。
- 除 `Foundation/Desktop` 外，`Src` 内不得直接导入 `@tauri-apps/*`。
- 长期工作台事实写入 Zustand；EventBus 只传递短暂通知和导航意图。
- Rust 是持久文档的权威，前端控制器持有乐观投影、选择、历史和同步状态。
- `Extension` 目前仅包含命令注册，不代表已存在插件市场、沙箱或扩展运行时。

## 不纳入文件树的内容

- `node_modules/`、`.pnpm-store/`：本地依赖缓存。
- `Dist/`：Vite 生产构建产物。
- `src-tauri/target/`：Cargo/Tauri 构建产物。
- `src-tauri/gen/schemas/`：Tauri 自动生成 schema。
- `.aurona-local/`：本机性能原始数据和其他不提交的开发数据。
