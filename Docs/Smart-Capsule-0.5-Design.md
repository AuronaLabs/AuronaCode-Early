# Smart Capsule 0.5 设计草案

## 0.4.13 boundary

The current release only prepares runtime contracts for this design. `AgentToolMetadata`,
`WorkspaceContextProvider`, and `MemoryProvider` are available to the runtime, while the Sidebar
continues to use the existing Assistant interaction. No Smart Capsule surface, intent planner, or
approval capsule is shipped in 0.4.13. This document describes the 0.5.x direction and is not an
implementation checklist for the current release.

Smart Capsule 是 0.5.x 的工作入口：它把用户意图转换为可审阅、可中断、可恢复的 Agent 运行，而不是另一个聊天面板。0.4.x 只保留必要的事件、审批、编辑器上下文和结果展示能力；本文件定义 0.5 的边界，不代表本版本实现。

## 目标

- 用一句自然语言表达目标、约束、范围和完成标准。
- 在执行前显示 Agent 对意图的理解，允许用户修改或确认。
- 将计划、工具调用、上下文和记忆拆成可观察的运行阶段。
- 支持停止、继续、重试和恢复，并让每个副作用都有可追溯的依据。
- 让编辑器、终端、源代码管理和扩展以统一能力接口接入。

## 分层

### Intent Layer

Intent Layer 负责理解用户想要什么，不负责直接读写文件或调用网络。输入包括用户文本、当前工作区、编辑器上下文和显式约束；输出是结构化意图：目标、范围、限制、优先级、完成标准和待确认问题。

Intent Layer 可以请求澄清，也可以生成候选计划。它不得绕过审批、修改工具参数或伪造执行结果。用户确认后，意图版本被冻结并带有稳定 ID，后续事件引用该版本。

### Runtime

Runtime 负责调度单个本地 Agent 的生命周期：队列、步骤、Responses 流、取消、steer、重试、checkpoint、审批和事件持久化。Runtime 不理解具体文件格式，也不直接访问 Tauri 文件 API；所有副作用必须通过 Tools 能力完成。

Runtime 的状态来源是事件。运行状态可以从事件重建，流式事件丢失时可从最后一个 checkpoint 或 Responses response ID 恢复。未知供应商事件必须保留原始数据，但不能阻塞已知事件处理。

### Tools

Tools 是受权限和工作区边界约束的副作用接口。每个工具声明名称、参数 schema、风险级别、是否需要审批、可取消性和输出格式。工具只接收 Runtime 提供的调用上下文，不自行读取隐藏会话状态。

工具执行前创建 checkpoint；执行期间报告进度；完成时返回结构化结果和受影响路径。工具失败必须返回可解释错误，不能把异常或原始供应商 JSON 当作成功内容。新增工具必须通过统一的 tool registry 和 capability gate。

### Context

Context 负责为一次模型调用准备可审阅输入：当前意图、选区、诊断、相关文件、工具结果和用户明确提供的内容。Context 具有来源、时间、大小和敏感性元数据，并按预算裁剪。

Context 不拥有持久化记忆，不执行工具，也不偷偷扩大工作区范围。被裁剪的内容要记录摘要和原因，避免 Agent 误以为看到了完整文件。

### Memory

Memory 保存用户明确允许长期保留的偏好、项目事实和运行摘要。Memory 与一次运行的 Context 分离，读取必须有来源和新鲜度，写入需要用户可见的理由和删除入口。

Memory 不保存 API key、完整文件内容、未确认的推断、工具原始参数或审批凭据。项目级记忆和个人级记忆使用不同命名空间，删除会清理索引和关联摘要。

## 运行协议

1. Intent Layer 生成意图草案和澄清问题。
2. 用户确认目标、范围和风险级别。
3. Runtime 创建运行事件并请求 Context 快照。
4. Responses 模型产生文本、工具参数增量和完成状态。
5. Runtime 校验工具 schema，必要时创建 checkpoint 并请求审批。
6. Tools 执行并回传结果；Context 只加入本次允许的结果。
7. Runtime 继续、暂停、失败或完成，并生成可定位的产物摘要。

所有阶段都支持取消。取消必须结束待审批 Promise，并阻止已取消运行继续发起下一次模型请求。

## UI 原则

Smart Capsule 使用统一的编辑器/侧边栏输入框和现有 tokens。默认只展示意图、当前阶段、工具胶囊、审批和最终结果；详细事件、Context 来源和 Memory 命中放入可展开的审阅区域。避免把 Runtime 内部的 task、step、response 字段直接暴露为产品文案。

## 非目标

0.5 不实现云 Agent、并行子 Agent、自动 Git commit/stash、隐式长期记忆、后台无审批写入和跨项目 Context 合并。
