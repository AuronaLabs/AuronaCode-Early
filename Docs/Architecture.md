# 当前架构

本文描述 **Aurona Code 0.4.17** 的模块组织与运行时边界。架构以清晰的状态所有权、公开接口和可回收的生命周期为基础；具体整改与验证见[开发与交付记录](0.4.17-Development-Plan.md)。

## 工作台如何协作

前端使用 React 与 TypeScript，桌面能力由 Tauri 和 Rust runtime 提供。业务代码通过 `Src/Foundation/IPC` 的类型化接口访问宿主，Tauri API 的直接适配集中在 `Src/Foundation/Desktop`。

Rust 管理文本模型、工作区访问、Git、进程、LSP、DAP、PTY、网络策略、扩展运行时与持久化。前端提供操作意图和上下文，后端复核权限、路径及生命周期。

## Corona+ 分层

| 层级 | 职责 | 协作约束 |
| --- | --- | --- |
| `Foundation` | 平台适配、IPC、基础类型、存储与通用工具 | 不依赖业务页面或布局 |
| `Core` | 文档、工作区、Git、语言服务、AI 与扩展等领域服务 | 通过公开接口协作，领域逻辑与视图分开 |
| `State` | 领域状态与订阅 | 状态有明确所有者，副作用通过服务或用例管理 |
| `Features` | 编辑器、资源管理器、终端、扩展和设置等功能 | 使用领域入口，跨功能装配明确表达依赖 |
| `UI` | 通用控件、材质、图标、Toast 与对话框 | 保持通用性，业务通知由上层协调 |
| `Layout` | 工作台区域、布局与插槽 | 承载视图组合，避免嵌入特定扩展业务 |
| `App` | 启动、组合根、服务装配与清理 | 管理就绪顺序与全局生命周期 |

`scripts/check-desktop-boundaries.mjs` 使用 AST 分析运行时引用、模块边界和依赖环。检查覆盖范围内的通过结果是工程证据；领域职责仍需要代码审查与行为回归共同确认。

## 主要领域

| 领域 | 主要入口 | 关注点 |
| --- | --- | --- |
| 编辑与文档 | `Src/Core/DocumentService.ts`、`Src/Features/Editor`、Rust `editor.rs` | 文本 revision、编辑缓冲区、保存和冲突检测 |
| 工作区 | `Src/Core/WorkspaceService.ts`、Rust `commands/fs.rs` | 根目录授权、路径身份、分页访问与目录恢复 |
| Git | `Src/Core/GitService.ts`、Rust `commands/git.rs` | 仓库会话、请求取消、差异和恢复记录 |
| AI 与 Agent | `Src/Core/Agent`、`ai_chat.rs`、`ai_profiles.rs` | 凭据引用、流式响应、工具审批和 checkpoint |
| 语言与工具 | `Src/Core/Language`、`launch_registry.rs`、`lsp.rs`、`dap.rs`、`pty.rs` | 启动配置、协议状态、进程与会话释放 |
| 扩展与市场 | `Src/Core/Extensions`、`Src/Features/Extensions`、Rust `extensions/` | 安装策略、WASM 会话、权限、视图和宿主桥接 |

## 启动与异步协作

- 启动 UI 与服务装配位于 App 层，授权监听就绪后再开放相关工作区操作。
- 工作区恢复区分候选目录、授权状态与实际提交，避免授权流程阻塞主界面自身挂载。
- Git、文档与扩展异步响应携带所属上下文；过期结果在写入状态前检查代次与路径。
- 命令、订阅、计时器、watcher 与扩展会话各有释放责任，停用或切换时清理旧资源。

## 运行时与信任

文件访问绑定规范化工作区路径与授权状态。AI 请求通过后端端点策略，凭据使用系统密钥环；本地工具通过启动配置与用户选择执行。

扩展运行于 WASI Preview 2 宿主。包签名和目录签名采用独立可配置策略，权限、包结构检查与运行预算继续生效。应用更新签名拥有独立的信任链，详见[安全与信任](Security-and-Trust.md)。

## 验证

本机 `quality:full` 覆盖前端及当前主机 Rust 检查；GitHub Quality 额外执行三平台 Rust 与扩展矩阵。单元测试、真实 WASM 组件、发布产物校验与桌面操作验证分别提供不同层次的证据。

发布流程把构建、产物验证与渠道发布分开。当前版本的验证入口与尚需桌面验收的场景记录在[交付记录](0.4.17-Development-Plan.md)和[兼容层能力矩阵](0.4.17-VSCode-Compatibility-Matrix.md)。
