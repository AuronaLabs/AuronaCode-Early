# 0.4.18「稳」开发验收记录

**把变化留在边界内，让日常开发更从容。**

记录日期：2026 年 10 月 31 日。开发分支：`codex/0.4.18-stability`。迁移基线：`ae3194a97fa0c883ab6ac7ce9d46950c3920d14e`。

本记录是截至 2026 年 10 月 31 日的开发与本机自动化验收快照。0.4.18「稳」现已发布；对外变化见[正式更新说明](../../Releases/0.4.18/Release-Notes.md)。本机自动化结果不替代真实桌面、输入法、DPI 和目标系统安装验收。

[开发规划](Development-Plan.md) · [架构决策](Architecture-Plan.md) · [迁移前基线](Architecture-Baseline.md) · [当前架构](../../Architecture/README.md)

记录编写时，应用内 ChangelogData 将 0.4.18 标为开发中；正式发布时已同步发布日期和最新版本标记。该快照中的实现范围与测试记录仍可用于追溯本地验收依据。

## 实现范围

| 任务 | 本轮实现 | 验收状态 |
| --- | --- | --- |
| S18-01 | TypeScript 完整模块解析、公开入口清单、Core→State、跨 Feature、运行时环及 Rust 迁移领域规则 | 正反 fixture 和源码检查；最终结果见下表 |
| S18-02 | DisposableScope 逆序释放、幂等、部分失败、晚到资源清理；会话代次隔离 | 应用、Git、插件、SDK、配置订阅等生命周期回归 |
| S18-03 | 工作区 generation、路径身份、授权控制器、监听就绪与启动分离 | 切换、失败、重复挂载、授权清理测试；真实桌面待验收 |
| S18-04 | 命令装配进入 App，工作台恢复/持久化/对话框/提示抽离，调试状态归 Core | Core 不再引用 State；工作台、命令、调试回归 |
| S18-05 | 文档每路径事务队列、打开去重、保存/关闭排序、独立语言适配、UTF-16 快照编辑 | 文档及编辑器自动化；IME/DPI/真实 LSP 待验收 |
| S18-06 | Git 查询合并、每仓库缓存、写后统一失效、旧响应隔离、页面退出不误取消共享操作 | 服务回归与 Rust 临时仓库测试；原生工作流待验收 |
| S18-07 | Registry 与 React 绑定分开；市场传输/模型/安装分开；SDK 注入端口；桥接有所有者 | 旧请求、权限竞态、资源释放、真实兼容 Demo 的自动化 |
| S18-08 | 默认值与有效配置解析、成功写入通知、嵌套更新队列、失败恢复和统一主题应用 | 保留显式 false/0；安全开关与配置故障测试 |
| S18-09 | 原生插件与兼容 Webview 共用主题快照，系统主题正确解析，主体透明 | 主题与文档合成/净化回归；视觉截图待验收 |
| S18-10 | Rust workspace/filesystem/git/editor/runtime 拆分，IPC 名称、权限与预算保持 | 格式、Clippy、编译与单元测试，结果见下表 |
| S18-11 | 本记录、迁移定位、架构/贡献说明及 dev 清单 | 自动化与文档收尾；三平台、桌面和性能仍是发布前工作 |
| S18-12 | 未扩大重排 Agent、调试页面等剩余模块 | 可选项未纳入；不存在已完成的性能提升承诺 |

## 一并修复的问题

- 并发打开同一文档只创建一次会话；关闭后的重新打开按事务顺序执行，失败关闭保留可编辑状态。
- 保存和基础文本 flush 不等待 LSP 队列；语言服务卡住时，文档事务可以继续。语言结果使用创建文档时的适配器与会话。
- SDK 多行替换根据原文档的 UTF-16 范围计算，避免替换成更短文本时残留旧尾部；拒绝越界、反向和重叠范围。
- SDK 文档事件来自已确认的打开/变更/保存/关闭事务，切换标签或移动光标不冒充文本变更；diff 和扩展标签不冒充文档。
- Git 写操作失败后也失效并刷新状态；成功写入后若状态刷新失败，保留实际操作结果并记入源代码管理输出，避免误报提交或推送失败。输出订阅者异常独立处理，不再改变业务操作结果。
- 工作区切换、插件宿主退出、权限更新与账户注销使旧结果失效，避免迟到的初始化或查询恢复旧状态。
- 设置只在写入成功后发布配置，失败不污染下一次写入；编辑器、终端、材质和系统主题通过同一应用入口更新。
- CSS 净化器显式解析自定义属性，保留安全主题变量；变量中的远程资源仍被拒绝，CSP 与 sandbox 保持原策略。
- 无编辑器视图时的保存回退，在等待输入确认后重新读取 dirty，避免使用等待之前的旧快照。
- 关闭过程中的关键持久化失败保留窗口、显示错误并允许重试；异步事件处理失败不再形成未捕获拒绝。

## 追加整改与文档组织

- 源代码管理页由原来 997 行的混合实现拆为页面、`hooks/useSourceControl.ts` 和 `components/GitFileRow.tsx`；仓库查询和写后失效仍归 `Core/Git`，页面只管理自己的订阅与操作上下文。
- 切换工作区时清理旧分支、远端、计数和弹窗。读取失败显示错误与刷新入口，不再误显示旧仓库或把失败当作未初始化。
- 操作使用立即生效的页面互斥标记，避免连续触发重复写入；旧工作区的完成回调不能清理新操作。用户取消不冒充失败，提交期间编辑的新草稿不会被完成回调清空。
- 文件行按钮补齐可访问名称、忙碌禁用和键盘焦点显现，便于通过键盘完成暂存或取消暂存。
- 15 份当前文档按指南、架构、开发和发布重新组织，迁移时重写 128 处链接；新增[仓库地图](../../Architecture/Repository-Map.md)、[本地开发指南](../../Guides/Local-Development.md)和[文档维护约定](../../Conventions.md)。历史审计的状态、结论与固定引用路径继续保留。
- `check:docs` 检查全仓未忽略的 Markdown、本地路径大小写、标题锚点、表格和代码围栏；`test:docs` 覆盖正常与异常案例，两项均已加入本机汇总与 GitHub Quality。
- 启动检查时发现开发首页请求超时；Vite 的监听范围补充排除本地包缓存、扩展 target、candidate 与日志，减少无关生成目录参与开发监听。该调整不作为启动性能提升百分比的证据。

## 追加缺陷排查

| 问题与复现条件 | 修复 | 自动化覆盖 |
| --- | --- | --- |
| 同时保存工作区路径、活动标签或侧栏宽度 | 等待读取后基于当前内存合并字段，避免并发调用互相覆盖 | 并发合并、去抖与最新快照 |
| 工作台状态写盘失败后关闭窗口 | 记录未保存状态，将失败传递至关闭检查；重试重新写入快照 | 后台失败、关闭 flush、失败后恢复、写入排序 |
| 设置或工作台更新尚未完成初始化便请求 flush | 统一登记尚未进入磁盘队列的更新，关闭检查等待这些请求完成 | 两项先复现、后修复的关闭屏障回归 |
| 缓存重置期间仍有读取或写入 | 会话代次隔离旧读取，保留在途磁盘写入的顺序 | 迟到读取、重置期间在途写入、非法根数据 |
| 终端清理时 Shell 发现尚未完成 | 旧请求不能创建终端或回填新缓存；临时失败可再次发现 | 清理与重启、并发发现、失败重试 |
| 命令等待启动或注册监听时被取消、终端关闭 | 回收计时器和监听，迟到注册立即释放；已释放终端不再派发命令 | 启动取消、运行取消、关闭、清理、迟到监听 |
| 终端视图快速重挂载，旧 PTY 事件或启动结果迟到 | 明确记录会话身份，旧事件与完成回调不能影响新视图，迟到监听仍需释放 | 初次会话接管、替换与旧事件过滤、视图异步注册、20 次重复挂载 |
| 输出分块、命令回显或多字节字符跨块 | 按完整标记行读取有符号退出码，使用流式 UTF-8 解码 | 回显、退出码分块、中文跨块 |
| 不同 Shell 的命令结束规则不一致 | PowerShell 重置并读取正确作用域的退出码，错误仍输出标记；CMD 单独输出标记行；修正 POSIX 和 Fish 语法 | 真实 Windows PowerShell、CMD 和 POSIX Shell 集成；Fish 包装单元回归 |
| 终端面板关闭最后一个终端后再次打开 | 初始化请求完成后释放共享 Promise，与命令入口合并默认终端创建 | 面板与命令并发初始化、关闭后重建、20 次启停订阅清理 |

新增真实 Shell 测试仅启动短时命令进程，不启动桌面 dev。Windows 可通过临时环境变量 `AURONA_TEST_POSIX_SHELL` 指定 Git for Windows 的 `sh.exe` 运行 POSIX 回归；默认 Linux/macOS 使用 `/bin/sh`。这不等同于完整 PTY 或终端界面验收。

GitHub 协作文件保留特殊约定位置，新增目录职责索引，缺陷和 PR 模板补充环境、配置、复现与验证要求。构建检查生成的三份已跟踪扩展归档恢复为原基线，本轮仅保留相关源码和文档变更；下次打包仍按现有准备流程重新生成。

## 文件迁移速查

| 旧入口 | 当前入口 |
| --- | --- |
| `Src/Extension/CommandRegistry.ts` | `Src/Core/Commands/CommandRegistry.ts` |
| `Src/Core/Commands.ts`、`AccountCommands.ts`、`Fliuno/commands.ts` | `Src/App/Contributions/WorkbenchCommands.ts`、`AccountCommands.ts`、`FliunoCommands.ts` |
| `Src/State/useWorkspaceStore.ts` | `Src/State/Workbench/useWorkbenchStore.ts`，副作用由 `Src/App/Workbench/WorkbenchLifecycle.ts` 装配 |
| `Src/Core/WorkspaceService.ts` | `Src/Core/Workspace/index.ts`，路径规则在 `WorkspacePath.ts` |
| `Src/Core/DocumentService.ts` | `Src/Core/Documents/index.ts`，语言适配在 App，范围编辑在 `DocumentEdits.ts` |
| `Src/Core/GitService.ts` | `Src/Core/Git/index.ts` |
| `Src/Core/DebugService.ts` 等 | `Src/Core/Debug/`；`State/useDebugStore.ts` 保留 React 绑定 |
| `Src/State/useExtensionStore.ts` 的业务逻辑 | `Src/Core/Extensions/ExtensionRegistry.ts`；原文件保留 React 绑定 |
| `Src/Features/Extensions/SDK/AuronaSDKHost.ts` | `Src/Core/Extensions/Host/AuronaSDKHost.ts`，UI 端口由 `Src/App/Contributions/ExtensionSDK.ts` 装配 |
| `Src/Features/Extensions/ExtensionHostBridge.ts` | `Src/App/Contributions/ExtensionHostBridge.ts` |
| `src-tauri/src/commands/fs.rs` | `workspace/mod.rs`、`workspace/ipc.rs`、`workspace/filesystem/`、`workspace/digest.rs` |
| `src-tauri/src/commands/git.rs` | `git/mod.rs`、`git/recovery.rs`、`git/ipc.rs`、`git/tests.rs` |
| `src-tauri/src/editor.rs` | `editor/mod.rs`、`editor/ipc.rs`、`editor/tests.rs` |
| `src-tauri/src/extensions/runtime.rs` | `extensions/runtime/mod.rs`、`host.rs`、`resources.rs`、`limits.rs`、`tests.rs` |

调用侧已迁移，不保留旧 TypeScript 服务路径空壳。Rust `commands/mod.rs` 的 fs/git 重导出仅用于保留原 handler 注册命名；业务状态直接使用领域模块。历史审计仅更新源码与测试定位，状态、日期和旧验收结论保持不变。

## 本机自动化

环境：Windows x64、Node.js 24.22.1、Rust 1.99.1、MSVC Build Tools 18.11.1。本轮 Shell 命中宿主回退 pnpm 11.25.0；项目声明仍是 pnpm 12.15.0，没有修改依赖或锁文件。本机结果不替代 CI 的 Node 22、Rust 1.95.0 与三平台矩阵。验证日志保存在本机 `E:/DevCache/AuronaCode/0.4.18/`，未放进仓库。

| 检查 | 结果 |
| --- | --- |
| TypeScript / Biome | `typecheck` 通过；`biome ci Src` 通过，494 个文件，无修改建议 |
| 前端全量回归 | 137 个测试文件、591 项测试全部通过，未跳过前端测试；包含真实 TypeScript Language Server、Windows PowerShell、CMD 及 Git for Windows POSIX Shell 集成，以及终端会话、关闭屏障和源代码管理页面回归 |
| Corona+ / Rust 领域边界 | 344 个生产模块、1,257 条运行时依赖边、0 环；迁移 Rust 领域规则通过 |
| Markdown 文档 | 全仓文档检查与 6 项检查器回归通过；覆盖规模见下文 |
| 材质 / i18n | 材质边界通过；i18n 为 0 个结构错误、92 个既有硬编码中文警告 |
| 发布元数据 / 审计 / 扩展契约 / 内置资源 | smoke、审计、兼容层和内置资源检查通过；发布契约 3 项、扩展/边界契约 14 项通过 |
| 前端生产构建 | `pnpm run build` 通过；保留已有打包体积提示，不据此声称性能达标 |
| Rust fmt / Clippy / check / test | `pnpm run quality:rust` 通过；fmt、Clippy 全目标且警告视为错误、cargo check 通过；218 项测试通过、0 失败、1 项忽略；新增 20 次 runtime 资源回收回归通过 |

最终前端、生产构建与工程检查日志分别为 `frontend-final-reviewed.log`、`build-final-reviewed.log`、`checks-final-reviewed.log`，对应 `.exit` 均为 0；后续仅校对本记录。Rust 沿用本轮此前已通过的 `rust-final.log`，此后没有追加 Rust 源码修改。中间复现失败和被主动停止的开发日志不代表最终结果。

带清理职责的新增自动化包含 20 次应用侧/插件侧重复注册与释放，以及 Rust runtime 租约与事件回收。该结果只证明覆盖的登记和所有权行为，不等同于操作系统 watcher、进程和 RSS 的完整泄漏测量。

Rust 忽略项为 `account_auth::tests::local_aurona_account_discovery_contract_is_compatible`，需要本地 Aurona Account/Auth 开发服务；本轮未运行该服务集成测试。

前端测试仍有 Fliuno 的 React `act` 提示和 jsdom 未实现 Canvas 的提示；相关测试通过，真实绘制与交互仍需桌面确认。文档检查已从局部抽检扩展到全仓，最新复验覆盖 51 份 Markdown、263 个本地链接、76 张表格。此前另核对 143 处历史审计源码/测试引用；历史状态、冻结日期、说明和剩余事项保持不变。

## Dev 桌面测试清单

在仓库根目录运行 `pnpm run tauri:dev`。`pnpm run dev` 仅启动前端，不能作为文件、Git、终端与插件宿主验收。

| 场景 | 建议操作 | 重点观察 |
| --- | --- | --- |
| 启动与授权 | 冷启动、已有工作区恢复、拒绝/允许/暂缓、连续切换两个项目 | Splash 不被原生信任弹窗阻塞；旧项目不回写，提示不重复 |
| 日常编辑 | 中文 IME、emoji、Tab、CRLF、多光标、撤销，快速切标签并保存 | 光标/选区/装饰对齐；文本不丢失，dirty 与磁盘一致 |
| 故障关闭 | 临时项目中模拟保存失败，取消关闭后重试 | 错误可见、窗口保留、原文档仍可处理 |
| Git | 临时仓库暂存/取消暂存/提交/切分支；本地 bare remote 测试同步 | 面板、gutter、计数一致；取消与失败不会复活旧仓库 |
| 扩展 | Demo 激活、树/命令/Webview，禁用再启用，离线/取消安装 | 事件和状态栏不重复；停用后的旧请求不继续影响页面 |
| 安全配置 | 包签名、目录签名、工作区/进程等开关双向切换并重启 | 用户选择保留；应用更新签名仍独立 |
| 主题与界面 | 深/浅/系统主题、材质强度、字体、窄窗口、不同 DPI | 插件颜色跟随主题；Markdown 主体透明，胶囊和菜单无额外背景叠层 |
| 常用桌面工具 | F12、终端、LSP、DAP、账户弱网恢复 | 可选服务失败不拖住编辑与关闭；输出信息足以定位 |

UI 问题请记录页面、操作、主题、Windows 缩放比例和截图；编辑/Git 问题附临时项目的最小复现。不要在真实重要仓库上做丢弃或故障恢复试验。

## 本记录未覆盖的实测范围

- 目标设备上的完整桌面交互与安装包抽检，包括 F12、IME、DPI、工具链、插件和 Git 原生流程。
- 同机同模式的冷/暖启动、输入、Git 和资源趋势测量。迁移前未冻结完整实测数据，本版不据此声称性能提升比例或性能防退化验收已完成。

平台构建、签名候选和 GitHub Quality 由发布工作流另行执行，其结果不包含在本机日志统计中。当前保留 Editor Hooks、Agent 主流程、LSP/DAP 历史状态组织及 VS Code 兼容矩阵范围，避免把本次结构整改描述成全仓彻底重写。
