# Aurona Code 当前架构

当前开发版本为 `0.4.14`。本页只记录当前边界；历史版本的详细架构说明位于 [Archive/Architecture-Legacy-0.4.13.md](Archive/Architecture-Legacy-0.4.13.md)。

## 分层

React 功能层通过 `Src/Foundation/IPC` 使用 Tauri typed IPC，不能直接访问 Rust 命令。`Core` 管理文档、Git、AI、Agent 和工具服务；`Features` 组合编辑器、Explorer、Marketplace、终端和设置；`Layout` 管理工作区；`UI` 提供无业务的组件和反馈。

Rust runtime 负责工作区 scope、generation、文件和 Git、网络策略、进程树、LSP/DAP/PTY、扩展 WASM 宿主、Marketplace 包和存储。前端传入的 root、executable、URL 或凭据不能替代后端授权。

## 运行时边界

- 文件和 Git 操作绑定 canonical workspace root、调用方和 generation；路径、符号链接、junction 和恢复记录在后端复核。
- AI 通过 Rust 端点策略访问网络。配置只保存 `credentialId`，密钥来自系统 keyring；请求、SSE、工具和并发均有预算。
- LSP、DAP 和 Python 使用后端 launch registry，启动配置绑定 cwd、参数、环境和文件指纹。PTY 单独管理会话，初始目录需要工作区或原生授权；shell 内的访问仍由操作系统权限决定。
- 扩展使用 WASI P2、权限和宿主 CSP；远程包必须通过固定 Ed25519 公钥验证，未签名本地包首次运行需确认。
- 目录、下载、解压、watcher、PTY、协议、历史和 checkpoint 使用共享限额，超限返回结构化错误。

实现与证据见 [0.4.14 状态矩阵](0.4.14-Implementation-Status.md)和[验收报告](0.4.14-Acceptance-Report.md)。

## 模块与数据

| 领域 | 主要模块 | 职责 |
| --- | --- | --- |
| 编辑 | `Features/Editor`、`editor.rs`、`scoped_file.rs` | Rope 文本、revision、编辑缓冲区、冲突检测与保存；缓冲区独立于热视图。 |
| 工作区 | `commands/fs.rs`、`file_uploads.rs`、`resource_limits.rs` | 根保护、句柄路径访问、分块写、分页 cursor、监听合并与配额。 |
| Git | `Core/GitService.ts`、`commands/git.rs`、`process_service.rs` | 仓库授权、读写协调、取消、错误脱敏及持久恢复日志。 |
| AI / Agent | `Core/Agent`、`ai_chat.rs`、`ai_profiles.rs`、`agent_storage.rs` | 配置 ID、keyring、流式请求、工具元数据、审批和加密恢复记录。 |
| 工具 | `launch_registry.rs`、`toolchains.rs`、`lsp.rs`、`dap.rs`、`pty.rs` | 注册启动、安装事务、协议状态机、输出背压和进程生命周期。 |
| 扩展与市场 | `extensions/`、`artifacts.rs`、`artifact_signature.rs`、`marketplace_catalog.rs` | 包验证、WASM 隔离、host bridge、资源清洗和签名缓存。 |

应用配置、包、缓存和恢复记录保存在系统应用数据目录；AI 凭据和 Agent 加密密钥使用系统 keyring。工作区和 Git 恢复数据具有不同的所有权与清理规则，详见 [安全与迁移](0.4.14-Security-and-Migration.md)。

## 验证边界

单元测试、隔离桌面 harness 和生产安装器是不同证据。Harness 使用独立 identifier 和测试工作区授权；正式候选排除 `audit-harness` feature。生产能力、原生批准/取消、三平台工作流、签名来源和性能回归阈值都需要单独验收。

`quality:full` 执行本机前端与 Rust 检查，GitHub Quality 额外执行三平台 Rust/扩展矩阵。发布构建、draft 上传和渠道推进分开；任何测试 fixture 都不能提供正式发布信任。
