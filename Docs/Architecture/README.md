# 当前架构

本文描述 **0.5.0 Alpha1** 的模块组织与运行时边界。本轮范围与验证见[Alpha1 开发记录](../Development/0.5.0-alpha.1/Implementation.md)。

[仓库地图与模块放置](Repository-Map.md) · [设计原则](Design-Principles.md) · [本地开发](../Guides/Local-Development.md)

## 工作台如何协作

前端使用 React 与 TypeScript，桌面能力由 Tauri 和 Rust runtime 提供。业务代码通过 `Src/Foundation/IPC` 的类型化接口访问宿主，Tauri API 的直接适配集中在 `Src/Foundation/Desktop`。

Rust 管理文本模型、工作区访问、Git、进程、LSP、DAP、PTY、网络策略、扩展运行时与持久化。前端提供操作意图和上下文，后端复核权限、路径及生命周期。

## Corona+ 分层

| 层级 | 职责 | 协作约束 |
| --- | --- | --- |
| `Foundation` | 平台适配、IPC、基础类型、存储与通用工具 | 不依赖业务页面或布局 |
| `Core` | 文档、工作区、Git、语言服务、AI 与扩展等领域服务 | 通过公开接口协作，领域逻辑与视图分开 |
| `State` | 工作台呈现状态、React 绑定与领域投影 | Core 不引用 State；恢复和副作用由 App 装配 |
| `Features` | 编辑器、资源管理器、终端、扩展和设置等功能 | 使用领域入口，跨功能装配明确表达依赖 |
| `UI` | 通用控件、材质、图标、Toast 与对话框 | 保持通用性，业务通知由上层协调 |
| `Layout` | 工作台区域、布局与插槽 | 承载视图组合，避免嵌入特定扩展业务 |
| `App` | 启动、组合根、服务装配与清理 | 管理就绪顺序与全局生命周期 |

`scripts/check-desktop-boundaries.mjs` 使用 TypeScript 模块解析和 AST 检查运行时环、类型引用、Core→State、跨 Feature 与领域私有入口。公开入口清单位于 `scripts/data/source-domains.json`，规则有正反 fixture。Rust 检查限定在本次迁移的工作区、Git、编辑器和扩展 runtime：命令适配位于 `ipc.rs`，领域不得从旧 `commands::fs/git` 获取能力。这不等同于全仓 Rust 依赖图检查。

## 主要领域

| 领域 | 主要入口 | 关注点 |
| --- | --- | --- |
| 编辑与文档 | `Src/Core/Documents/index.ts`、`Src/Features/Editor`、Rust `editor/` | 按文件排序的事务、文本 revision、保存和冲突检测；LSP 为注入适配器 |
| 工作区 | `Src/Core/Workspace/index.ts`、Rust `workspace/` | 根目录授权、路径身份、代次、目录与文件恢复；文件操作位于 `workspace/filesystem/` |
| Git | `Src/Core/Git/index.ts`、Rust `git/` | 仓库查询合并、写后统一失效、旧结果隔离、取消及恢复 |
| AI 与 Agent | `Src/Core/Agent`、`ai_chat.rs`、`ai_profiles.rs` | 凭据引用、流式响应、工具审批和 checkpoint |
| 语言与工具 | `Src/Core/Language`、`launch_registry.rs`、`lsp.rs`、`dap.rs`、`pty.rs` | 启动配置、协议状态、进程与会话释放 |
| 本地扩展 | `Src/Core/Extensions`、`Src/App/Contributions`、Rust `extensions/runtime/` | Registry 管业务快照；Host 依赖窄端口；通过本地 artifact 导入扩展与工具链 |
| 配置与主题 | `Src/Core/Configuration/index.ts`、`Src/App/Bootstrap/AppearanceController.ts` | 有效默认值、已提交配置通知、主题生效与失败反馈 |
| 工作台与命令 | `Src/State/Workbench`、`Src/App/Workbench`、`Src/App/Contributions`、`Src/Core/Commands` | Store 管标签与布局，App 管恢复和交互，注册器管命令契约 |

## 生命周期与状态所有权

| 所有者 | 管理内容 | 释放或失效入口 |
| --- | --- | --- |
| `AppServices` 的 `DisposableScope` | 装配、命令、主题监听、导航、领域订阅 | 应用卸载或部分启动失败，逆序清理；迟到资源立即释放 |
| `WorkspaceService` | 当前工作区与切换操作代次 | 新打开、恢复或关闭使旧操作失效 |
| `DocumentService` | 每路径操作队列、文档快照、会话和语言适配器 | close 成功后删除会话；语言队列独立，不阻塞保存和 flush |
| `GitService` | 每仓库缓存、revision、共享查询 | 写操作前后及工作区变化时失效；页面卸载不取消其他消费者 |
| `ExtensionRegistry` / SDK / HostBridge | 描述符、权限、视图代次、扩展注册及桥接监听 | 工作区切换或最后持有者退出；旧响应不提交 |
| `UserConfigStore` / AppearanceController | 最后成功配置、写队列、成功订阅及样式投影 | 配置写成功后通知；应用 scope 释放 DOM 和配置监听 |

`DisposableScope` 支持幂等释放、晚注册立即释放和多错误聚合。清理错误不会阻止其余资源退出。关闭窗口先等待恢复数据、配置、布局数据及文档处理，关键失败保留窗口并显示错误，允许重试。

## 启动与异步协作

- 启动 UI 与服务装配位于 App 层，授权监听就绪后再开放相关工作区操作。
- 工作区恢复区分候选目录、授权状态与实际提交，避免授权流程阻塞主界面自身挂载。
- Git、文档与扩展异步响应携带所属上下文；过期结果在写入状态前检查代次与路径。
- 命令、订阅、计时器、watcher 与扩展会话各有释放责任，停用或切换时清理旧资源。

## 运行时与信任

文件访问绑定规范化工作区路径与授权状态。AI 请求通过后端端点策略，凭据使用系统密钥环；本地工具通过启动配置与用户选择执行。

扩展运行于 WASI Preview 2 宿主。本地包签名采用独立可配置策略，权限、包结构检查与运行预算继续生效。应用更新签名拥有独立的信任链，详见[安全与信任](../Guides/Security-and-Trust.md)。

## 验证

本机 `quality:full` 覆盖前端及当前主机 Rust 检查；GitHub Quality 额外执行三平台 Rust 与扩展矩阵。单元测试、真实 WASM 组件、发布产物校验与桌面操作验证分别提供不同层次的证据。

当前实现和验证范围见[Alpha1 开发记录](../Development/0.5.0-alpha.1/Implementation.md)。兼容层能力见[VS Code 兼容范围](../Guides/Extensions/VSCode-Compatibility.md)，不承诺完整 VS Code API 覆盖。

本次没有重排所有模块：Editor 保留已有 Hooks 和坐标模型；Agent 主流程仍在原领域；LSP/DAP 的历史 command/state 组织保留，工作区退出仍调用其现有停止入口。上述位置不属于新增边界规则宣称已完成的范围。性能、DPI、IME 和真实桌面视觉需要独立验收。
