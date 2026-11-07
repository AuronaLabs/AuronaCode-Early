# 0.4.18 架构审查基线

审查日期：2026 年 10 月 31 日。源码快照：`ae3194a97fa0c883ab6ac7ce9d46950c3920d14e`，应用版本 **0.4.17**。

本文记录为 0.4.18「稳」规划提供依据的静态审查结果。问题的运行时影响按已验证行为、结构风险与待验证假设区分；这里没有宣布重构已经完成。

[版本规划](Development-Plan.md) · [架构方案](Architecture-Plan.md) · [当前架构](../../Architecture/README.md)

本文保留迁移前快照的描述与统计；源码链接现指向对应的新入口，不能用链接中的新实现反推旧问题仍然存在。实际整改结果见[开发验收记录](Acceptance-Report.md)。

## 1. 审查结论

当前仓库已经具备 Corona+ 分层、类型化 IPC、文档 revision、工作区代次、Git 请求隔离和一批针对性测试。0.4.18 可以沿用这些基础，逐个领域整理边界与生命周期。

维护压力集中在三个位置：领域服务与界面状态互相认识；单个入口承担过多操作流程；状态、事件、缓存和资源释放缺少统一的所有权约定。这些关系即使没有循环导入，也会扩大一次修改的影响范围。

## 2. 可重复的依赖检查

```powershell
pnpm run check:boundaries
pnpm run test:extension-contract
```

本次已运行 `check:boundaries`；结果如下。契约测试的命令是复验入口，不表示本次已经执行。

| 项目 | 快照结果 | 解释 |
| --- | ---: | --- |
| 扫描 TS/TSX 模块 | 319 | 现有检查器排除 `.test` 和 `.d.ts`，仍包含 `Src/Test` 支持模块 |
| 运行时依赖边 | 1,183 | 按 AST 中可解析的引用计数，不是实际调用次数 |
| 运行时依赖环 | 0 | 当前解析范围内无环 |
| 现有层级规则违规 | 0 | 当前规则通过，不等于所有领域都已经解耦 |

实现见[检查入口](../../../scripts/check-desktop-boundaries.mjs)、[AST 分析器](../../../scripts/lib/source-boundaries.mjs)及[检查器测试](../../../scripts/source-boundaries.test.mjs)。

检查器目前存在以下覆盖边界：

- 领域间的依赖主要按顶层目录判断；Core 可以引用 State，Core 内部也没有公开入口与私有模块约束。
- 项目内依赖通过相对路径与有限的文件候选解析，没有接入 TypeScript 的完整模块解析。
- 没有检查跨 Feature 的视图装配、构造时订阅、异步取消归属和 Store 的副作用。
- 检查器自身目前只有两个 fixture 测试，主要覆盖 AST 引用与类型引用的区别。

补充扫描使用 TypeScript 模块解析统计引用热度，运行时环仍采用现有分析器。统计值用于定位审查对象；后续增强解析后需要建立新的同口径基线。

## 3. 已确认的结构问题

### 3.1 Core 反向依赖界面状态

以下生产文件引用 `State`：

| 入口 | 当前依赖 | 重构方向 |
| --- | --- | --- |
| [Commands](../../../Src/App/Contributions/WorkbenchCommands.ts)、[AccountCommands](../../../Src/App/Contributions/AccountCommands.ts)、[Fliuno commands](../../../Src/App/Contributions/FliunoCommands.ts) | 读取工作台、编辑器等 Store 并装配命令 | 内建命令装配移至 App，命令注册契约独立 |
| [AgentToolExecutor](../../../Src/Core/Agent/AgentToolExecutor.ts) | 访问工作台 Store | 通过窄接口请求打开或定位文件 |
| [DebugService](../../../Src/Core/Debug/index.ts) | 写入调试 Store | 运行状态归领域服务，State 提供订阅投影 |
| [DebugVariableDiff](../../../Src/Core/Debug/DebugVariableDiff.ts) | 从调试 Store 导入类型 | 类型归调试领域契约 |
| [UpdaterService](../../../Src/Core/UpdaterService.ts) | 读取功能开关 Store | 使用配置或功能开关服务接口 |

这里包含运行时引用与纯类型引用。两者都需要明确归属，但只有运行时引用进入运行依赖图。

### 3.2 工作台 Store 承担多种责任

[`useWorkspaceStore.ts`](../../../Src/State/Workbench/useWorkbenchStore.ts) 实际导出 `useWorkbenchStore`，同时包含标签与布局状态、文件路径身份、旧扩展标签迁移、持久化、文件对话框、诊断更新和 Toast。

名称与职责不一致；界面状态初始化又注册多种全局事件。文件重命名、删除、保存与关闭标签因此容易跨越多套状态。重构需要分别明确领域操作、界面投影和持久化，而不是按行数平均拆开。

### 3.3 文档服务同时协调语言协议

[`DocumentService`](../../../Src/Core/Documents/index.ts) 管理文档记录、打开与保存、订阅、IPC 队列等待，同时直接调用 LSP 的打开、变更、保存和关闭。

现有测试已覆盖 revision 同步与外部变更来源。后续需要把语言同步作为文档领域的订阅适配器，并覆盖打开去重、关闭后迟到响应、保存期间继续编辑等场景。上述场景目前是审查与验证任务，不能据此直接断言存在数据丢失。

### 3.4 Git 操作存在两条调用路径

[`GitService`](../../../Src/Core/Git/index.ts) 提供状态缓存、请求合并与部分写操作；[`SourceControl`](../../../Src/Features/SourceControl/SourceControl.tsx) 仍直接调用多种 `GitIPC` 写操作，另外处理刷新、错误、仓库上下文与取消。

这种并存增加维护成本：新增 Git 操作时需要决定缓存更新、取消和错误反馈分别放在哪一侧。0.4.17 已有请求隔离修复，需要保留这些语义并收拢用例入口。

`GitService` 在构造函数中订阅工作区，目前没有保存该订阅的 disposer。单例全程存活可以解释现状，但重启服务、热重载与故障恢复需要明确的启停所有权。

### 3.5 插件边界跨越业务、呈现与缓存

| 模块 | 观察到的责任 |
| --- | --- |
| [MarketplaceService](../../../Src/Core/Extensions/Marketplace/MarketplaceService.ts) | 来源配置、网络请求、凭据刷新、目录缓存、评价与收藏、扩展安装、LSP 与共享运行时安装 |
| [useExtensionStore](../../../Src/State/useExtensionStore.ts) | 描述符与视图缓存、IPC、权限目录、隐藏状态与初始化 |
| [AuronaSDKHost](../../../Src/Core/Extensions/Host/AuronaSDKHost.ts) | SDK 契约、文档与工作台访问、命令注册、状态栏、输入对话框和提示 |
| [ExtensionViewHost](../../../Src/Features/Extensions/ExtensionViewHost.tsx) | 声明式视图判断、HTML 转换、清理、主题 CSS 生成与视图呈现 |

扩展隐藏状态的配置文件与 localStorage 启动快照有不同用途，不能简单当成重复数据删掉。应明确持久来源、快照失效条件与写入失败处理。

### 3.6 设置的保存与生效流程分散

[`UserConfigStore`](../../../Src/Foundation/Storage/UserConfigStore.ts) 已提供写队列、原子写入与凭据迁移保护。这些能力应继续复用。

但启动时的 DOM 应用、设置页中的 DOM 更新、手动派发设置事件与功能内重新读取配置分别维护。例如编辑器设置页中，不同选项与重置操作采用不同的更新步骤；安全设置页还直接协调语言服务重载。

因此需要统一“有效值、保存结果、运行时生效”的流程，并区分保存失败与应用失败。审查没有把所有不同流程都认定为用户可复现的缺陷。

### 3.7 Rust 的领域状态位于命令适配层

[`commands/fs.rs`](../../../src-tauri/src/workspace/filesystem/mod.rs) 包含工作区状态、路径授权、目录与文件操作、删除恢复和 watcher。编辑器、调试、工具启动、AI、制品和上传等模块通过 `crate::commands::fs::WorkspaceState` 使用工作区领域能力。

[`commands/git.rs`](../../../src-tauri/src/git/mod.rs) 同时管理仓库锁、运行上下文、取消、命令执行、结果解析、恢复记录和 Tauri command。重构应把领域服务放到独立模块，让 command 保持协议适配职责。

[`extensions/runtime.rs`](../../../src-tauri/src/extensions/runtime/mod.rs) 同时包含上下文、资源预算、宿主能力、事件队列、watcher、组件缓存与运行时生命周期。现有安全与清理逻辑需要在拆分中完整保留。

## 4. 静态发现与待验证风险

| 编号 | 证据 | 当前判断 | 对应任务 |
| --- | --- | --- | --- |
| R18-01 | `WorkspaceApproval.tsx` 在注册成功路径两次执行 `disposers.push(...subscriptions)` | 静态重复登记已确认；二次释放的实际影响需测试验证 | S18-03 |
| R18-02 | 工作区恢复、打开、取消分别维护异步状态 | 需要验证连续 A→B→关闭时的提交顺序；尚未确认可复现故障 | S18-03 |
| R18-03 | 文档打开、编辑、保存、关闭各有异步返回 | 需要验证同路径去重、迟到回写、保存 revision 与脏状态；尚未确认数据丢失 | S18-05 |
| R18-04 | EventBus 的回调为 `void`，`emit` 只同步捕获异常，调用侧存在 async handler | 需要检查异步拒绝的处理责任；关键流程应由可等待的用例承接 | S18-02、S18-04 |
| R18-05 | GitService 与 SourceControl 各自承担部分操作与刷新 | 结构性重复已确认；取消与旧响应回归需保留 | S18-06 |
| R18-06 | 插件运行、桥接请求、watcher、视图与命令拥有不同清理入口 | 需要验证停用和卸载期间所有资源是否收敛 | S18-07、S18-10 |

工作区授权的源码证据见 [`WorkspaceApproval`](../../../Src/App/WorkspaceApproval.tsx)；事件实现见 [EventBus](../../../Src/Foundation/EventBus/index.ts)。这些风险均应先形成可重复场景，再决定修复范围。

## 5. 规模与依赖热度

按快照的文本行扫描，`AuronaEngine.tsx` 约 1,088 行、引用 42 个项目模块；`SourceControl.tsx` 约 1,004 行；`MarketplaceService.ts` 约 1,222 行；`AuronaSDKHost.ts` 约 684 行。

Rust 的 `commands/fs.rs` 约 2,412 行、`commands/git.rs` 约 2,348 行、`extensions/runtime.rs` 约 2,213 行，**均包含内嵌测试**。拆分前要进一步区分生产职责与测试体量。

补充扫描中，EventBus 有 48 处模块导入引用，UserConfigStore 有 28 处，工作台 Store 有 27 处，WorkspaceService 有 20 处，DocumentService 有 18 处。计数包含类型引用，不表示每个引用都有问题。

跨 Feature 引用共三处，集中在 Workspace 对语言结果面板与终端视图的组合。应将这类组合显式归到 App/Layout；目录检查需要区分合法装配与业务模块穿透。

国际化词典与历史更新数据文件也很长，但主要是静态数据，不列为按体量优先拆分的对象。

## 6. 已有证据与本次限制

现有测试涵盖 AppServices 重复启动和提前卸载、工作区授权监听就绪、Git 代次隔离、文档 revision 同步、编辑器坐标与输入，以及扩展契约等。规划以这些测试为保留基线，按新发现补齐场景，不把已有测试数量当成新的工作成果。

本次执行了源码审查与架构检查，未启动桌面应用进行视觉验收，也未重新运行完整 Quality。启动耗时、输入延迟、内存趋势和真实第三方扩展兼容性尚未建立本版实测基线，不能预先声称已有性能提升。
