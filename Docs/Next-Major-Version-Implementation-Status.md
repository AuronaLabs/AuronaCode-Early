# 0.4.13 第二波实施状态

## 0.4.13 second-wave runtime contracts

- `AgentToolMetadata` describes effects, permission, checkpoint policy, recoverability, and input
  schema for each built-in tool. Checkpoints use declared write or workspace-change effects rather
  than `edit_file` or `run_command` name checks.
- Tool argument and workspace-boundary validation runs before approval. Tool failures return
  `isError: true`; `get_tool_help` exposes capability metadata. Affected-file resolution is
  available for file edits and collects open documents for command execution.
- `WorkspaceContextProvider` provides project root, active/open files, language, selection, cursor,
  diagnostics, and recent changes without project indexing. `MemoryProvider` and its bounded
  in-memory implementation establish the interface for a later persistent store.
- Focused tests cover metadata, pre-approval validation, capability help, workspace context, and
  in-memory memory query/store behavior.

Smart Capsule remains design-only. The current Sidebar Assistant and its interaction model are
unchanged in 0.4.13.

当前开发版本为 `v0.4.13`。本文件记录第二波 Agent Runtime 稳定化与 Workspace Intelligence 基础已经落地、可以复核的工作，以及仍需完成的发布门禁，不再把旧的 0.4.12 规划当作当前状态。

## 已落地

- 编辑器继续使用 AuronaEngine，Markdown 原生预览支持 GFM、代码块和数学公式。
- Agent 使用 Responses API，工具调用、审批、停止和会话存储走统一事件模型。
- Agent 系统提示词明确了 Markdown、GFM、LaTeX、工具参数和审批边界。
- Agent 工具胶囊、Markdown 渲染、模型选择和会话切换已接入现有侧边栏设计系统。
- 扩展资源、工具链和写入路径已有基础路径边界校验，Marketplace 扩展按独立包分发。
- Git 状态、Problems、Code Action、Rename、Definition、References、Peek 和格式化能力已接入编辑器工作流。
- 主题、材质、玻璃层和 OOBE 使用共享 token 与组件，旧聊天历史不会再进入新 Agent 会话。

## 第二波已落地

- Agent 事件序号在裁剪和清空后仍保持单调，reducer 保持纯函数，会话与 checkpoint 存储支持校验、staging 和损坏备份。
- 写操作和命令执行前统一创建 checkpoint，恢复前校验文件指纹；停止、切换会话和审批取消不会再产生迟到的成功事件。
- Responses SSE 支持增量文本、函数参数、EOF、异常、超时、abort 和终态补发，运行时已移除旧 Chat Completions 路径。
- Code Action、WorkspaceEdit、Agent 修改和外部变更统一经过编辑器事务链，标签页保存、视图状态和恢复快照可持久化。
- OOBE 重跑会读取现有偏好，取消或保存失败会恢复草稿；脏标签页批量关闭进入真实保存流程。

## 后续批次

- 继续迁移前端硬编码文案；当前 i18n 检查报告 94 条非阻断警告，后续继续收敛。
- 完成真实 Tauri/WebView2 的窄窗口、Markdown、Editor、AI、OOBE、Fliuno 和 GPU/帧率验收。
- 继续审计命令可能修改多文件时的 checkpoint 覆盖范围，并补充真实桌面恢复流程。

## 已完成的自动门禁

- 前端：`pnpm run typecheck`、`pnpm run check`、`pnpm run i18n:check`、边界检查、扩展完整性、smoke、Vitest 和 Vite 构建已通过。
- 测试规模：前端 96 个测试文件、367 个测试通过；Rust 128 passed、1 ignored。
- Rust：VS2022 Build Tools 环境下的 fmt、Clippy、锁定依赖检查和测试已通过。
- Responses：本地 SSE fixture 覆盖增量文本、函数参数增量、usage、错误、超时、abort、无换行 EOF 和终态补发。
- Agent：事件 reducer、队列、steer、停止/继续、审批取消、checkpoint 指纹和旧数据迁移测试。
- Editor：差异应用/拒绝/撤销、上下文采集、标签页视图状态和外部变更测试。
- Agent / Editor：事件 reducer、工具元数据、checkpoint 指纹、Workspace Context、编辑器上下文和标签页视图状态测试已通过。

## 尚待真实桌面验收

- 在 Tauri/WebView2 中验证窄窗口、Markdown、Editor、AI、OOBE、Fliuno、GPU/帧率以及 checkpoint 恢复流程。
- 继续迁移前端硬编码文案；当前 i18n 检查报告 94 条非阻断警告。

## 本版明确不做

云 Agent、并行 Agent、worktree、Git commit/stash 编排和 Marketplace 升级路径留到 0.5.x 以后；本版只保证单本地 Agent 的可靠性和编辑器协作闭环。
