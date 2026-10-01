# Aurona Code 0.4.13 Agent 与 Editor 协作

## 0.4.13 runtime extension contracts

The stable runtime treats tool capabilities as data. Each registered tool may declare
`effects`, `permission`, `checkpointPolicy`, `recoverability`, and its input schema through
`AgentToolMetadata`. Checkpoint decisions use write or workspace-change effects rather than a
hard-coded tool-name list. A tool may also resolve its affected files so future tools can expose
multi-file changes without changing the runtime loop.

`WorkspaceContextProvider` supplies a bounded snapshot containing the project root, active file,
opened files, language, selection, cursor, diagnostics, and recent dirty or external changes. It
does not build a project index. `MemoryProvider` is an interface only in this release; the included
in-memory provider is a testable placeholder and does not persist project data.

Tool argument validation runs before an approval request. Missing arguments, workspace boundary
violations, ambiguous edit spans, and rejected commands are returned as error outcomes, so the
event stream cannot show a failed operation as successful. `get_tool_help` exposes the same
effects, permission, checkpoint, and recovery metadata used by the runtime.

The 0.4.13 acceptance scope covers these contracts and focused unit tests. Smart Capsule UI,
Intent Layer, multi-agent execution, cloud agents, project indexing, and background automation are
design work for 0.5.x and are intentionally not implemented here.

Aurona Code 0.4.13 的本地 Agent 使用可持久化事件和单一 Responses API。会话由有序的 `AgentEvent` 重建，工具调用、审批、checkpoint、错误和终态都进入同一条事件流；旧 Chat Completions 协议不再参与运行时。

侧边栏保持紧凑的 Agent 入口，正文采用连续对话阅读。工具执行以轻量状态行插入回复，完成后归并为可回看的调用记录；输入可以发送新消息、排队或 steer 当前响应。

写入工具执行前创建 checkpoint，保存受影响文件内容、指纹和 AuronaEngine 视图状态。恢复前重新校验全部指纹，发现外部变化时必须先查看差异，不能覆盖当前文件。停止、拒绝和切换会话会结束待审批状态。

Editor 继续使用 AuronaEngine。文件标签页保留光标、选区、滚动、折叠和 Markdown 模式；Agent 与 WorkspaceEdit 修改经过编辑器差异审阅，再逐文件或逐 hunk 应用，并支持撤销和重新定位。

本版本只支持单本地 Agent。并行 Agent、worktree、云端执行、Git commit 编排和 Marketplace 升级路径留到后续版本。
