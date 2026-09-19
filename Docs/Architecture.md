# Aurona Code 核心架构指南 (Corona+ Architecture Specification)

## V0.4.6 性能与生态篇

V0.4.6 聚焦「SDK 增量扩充、扩展可靠性与编辑器性能」：扩展兼容层修复与授权链路结构化、SDK 合约版本保持 1 的纯增量扩充、编辑器行级增量渲染与真实折叠（Beta）、AI 侧边栏（纯聊天）。

- **扩展可靠性**：`load_directory` 单包容错（失败进 `RegistryDiagnostics`，IPC `extensions_get_diagnostics` 可拉取）；`runtime_for`/安装自检返回 `[compat.*]` 结构化错误码，前端 `parseExtensionError` 映射 i18n；权限错误统一 `[permission.required:<perm>]` / `[permission.denied:<perm>]`，前端通用 `ExtensionPermissionPrompt` 弹窗并自动重渲染；假 watch 下线为显式 `unsupported`。
- **SDK v1 增量**（合约版本不变）：`read-workspace-range`（256KB 分块）/ `get-workspace-file-metadata` / `show-input-box` / `show-quick-pick` / `poll-events`；confirm / clipboard / execute-command 经宿主↔前端请求-响应桥（`extension://host-request` + `extensions_host_response`，超时保护）真实化；`clipboard.access` 权限开放；状态消息与通知走真实 UI。
- **编辑器增量渲染**：搜索匹配按行 Map 预计算、诊断按 (line:length) 缓存、行事件处理器 latest-ref 恒定引用、高亮 worker 未变行引用稳定化——打字只重绘 1-2 行。
- **真实折叠（editor.trueFolding Beta）**：`FoldingLineMap` 可视空间进入视口与渲染循环（visual↔real 双向映射），内容高度/光标/多光标层/括号引导线/补全锚点/scrollToLine/minimap 全坐标适配；折叠胶囊显示隐藏行数；灰度可回退。
- **功能靠齐**：Peek 定义（`editor.action.peekDefinition`，Alt+F12，内嵌浮窗）；补全详情栏 Markdown 渲染；右键菜单收窄 w-52 并分组语言命令；smoothCaret flag 接线；彩虹括号 6 色接入 `--EditorBracket*` 主题变量；深色语法色板重调（泛白 token 修正）+ Minimap 改读 CSS 变量。
- **AI 侧边栏（纯聊天）**：OpenAI 兼容协议经 Rust `ai_chat` 流式代理（SSE → `ai://chat-delta` 事件），走 `network::configure_client` 全局代理客户端；密钥仅存本地 UserConfig；会话历史 localStorage 持久化；内置卡片经 SidebarCardRegistry 收敛声明。

## V0.4.5 设计篇：玻璃染色 / 徽章体系 / 排版统一

V0.4.5 设计篇聚焦「玻璃语言全面落地与不统一感大扫除」：品牌化改名补课、Slider 玻璃化重做、浮层材质查漏、通知玻璃染色、徽章体系统一、主题色卡玻璃染色、设置行规格统一、空间管理单卡总览、Git Diff 推翻重做与硬编码色清零。

- **GlassContainer 实例染色 API**：新增可选 `tint` prop（CSS 颜色，如 `var(--StatusSuccess)`），渲染时注入 `--GlassInstance-Tint` 实例变量，背景 `color-mix(9%)`、边框 `color-mix(14%)`；不传时行为与普通玻璃完全一致。纯 color-mix 无额外合成层，变量走 `--GlassInstance-*` 命名空间不污染全局契约。通知/Toast 按 type 状态色整卡轻染（推翻 V0.4.4 左缘色条），主题色卡复用同一染色语言（废弃 `buildThemePreviewGradient` 渐变位图）。
- **Badge 公共徽章组件**：全局唯一胶囊规格（`rounded-full` + `text-[10px]` + `font-semibold tracking-wide`），三 variant——tint（状态染色）、solid（实心计数）、neutral（中性信息）。SourceControl PREVIEW、Appearance Beta/默认徽章、Changelog 最新、About basedOn、SettingsNavItem、WorkspaceBottomPanel problems、LocationResults/WorkspaceEditPreview 计数等全部收敛。
- **Slider snap-on-release 模式**：新增 `snapOnRelease` prop——拖动过程内部以 1 为步长细分（视觉连续跟手），`onValueChange` 回调时吸附最近档位；Thumb 垂直居中修复（`top-1/2 -translate-y-1/2`，Radix Thumb 默认无垂直居中 transform 是偏下根因）；轨道/Thumb 全面玻璃材质（`--switch-*` 令牌复用 + rim 高光 + saturate），拖动中微放大 + accent 光晕。
- **overlay 档位调优**：三档 blur 下调（light 8→6、medium 12→10、heavy 24→18；dark 同步下调）、`saturation` 上调（1.12/1.2/1.3）、`--GlassSurface-Floating` 白度下调（0.32→0.26 / 0.12→0.10），下拉菜单与 Tooltip 告别「磨砂蒙白布」；glassConfig.test.ts 数值同步。
- **设置行统一规格**：全部分区收敛为 `GlassContainer raised` 容器 + 行间 `border-t`（首行 `first:border-t-0`）+ `min-h-14` + `p-5` + `gap-6`；Editor/Debug/LanguageService/Advanced 的 `border-b last:border-b-0` 旧语言全部迁移。选中态语言统一：`border-[var(--color-accent)]` 直改边框（ToolchainsPanel）改为 accent 染底 + mix 细描边 + ring 阴影。
- **数据可视化令牌**：Theme.css 新增 `--VizTeal/--VizIndigo/--VizSky/--VizFuchsia`（深浅色双阶），空间管理占比环四色、扩展分类色点等收敛语义令牌；硬编码色清零（ExtensionSidebar red/emerald/amber、DeclarativeUIRenderer badge 色表、Marketplace 星标、GitGutterBar、MarkdownRenderer 链接色）。
- **DiffViewer 重做**：解析逻辑 `parseGitDiff` 与 `diffTarget` 协议不变，仅重写渲染层——头部信息卡玻璃化（rim 图标容器 + 胶囊 hash + 纯色 ±统计）、加载/错误/空态统一 EmptyState 语言（去 spinner）、加/删行语义色低透明度底 + 行内 2px 语义色标记；9 处硬编码中文接入 i18n（`sourceControl.diffViewer.*` ×6 语言）。

## V0.4.4 多轴玻璃材质 / i18n 工具链 / Fliuno 抽象 / Bento

V0.4.4 聚焦「玻璃质感二轮、i18n 工具链、Fliuno 双模式抽象、空间管理 bento 与通知视觉收敛」；供应链信任策略收紧（官方市场无哈希拒装）。

- **多轴玻璃令牌体系**：`GlassPreset` 从 blur+opacity 两轴扩展为六轴（新增 `shadowDepth`/`saturation`/`rimStrength`/`borderLuminance`，light/dark 独立预设表），`useGlass.applyToDOM` 全量写盘为 `--GlassShadow-Depth` 等令牌。**令牌命名契约**：`--Glass*` = 静态材质（档位全权，常驻渲染）；`--Liquid*` = 动态层可见性/幅度（`liquidTexture` 开关门控，幅度乘 `--GlassRim-Strength` 档位系数）。设置 UI 用 `UI/Components/Slider` 三档吸附控件（轻透/均衡/醇厚）。
- **液态折射深化**：背景光域提亮 + 主体光域 `liquid-hue-flow` 色相微流动（GPU filter，双速度组反相）；overlay 层新增第二条斜向折射带（::before 双渐变）与 rim 左右缘微反射（::after 三向 inset）；浮层 hover 时 specular 流动加速。所有动画选择器均挂在 `data-liquid-texture="true"` 下——开关关闭时无任何动画运行；reduced-motion 全降级；光域 ≤5 层红线保持。
- **i18n 工具链契约**：`scripts/i18n-check.mjs`（零依赖）以 zh-CN 为基准做 key 树 diff 与 `{placeholder}` 一致性校验（错误即 CI 失败），硬编码中文扫描为 warning；`scripts/i18n-add.mjs` 一次写六语言并自动定位嵌套位置（LF 写盘保序）。CI 在 Frontend job 独立 step 运行。
- **Fliuno 共享组件拓扑**：`Src/Features/Fliuno/components/` 承载双模式共享层——`useFliunoSearch`（debounce/session/文件索引/偏好持久化/最近记录 + `executeFliunoResult`）、`useFliunoKeyboard`（↑↓/Home/End/Page/Tab/Enter + 选中滚动）、`FliunoSearchRow`/`FliunoScopeRow`/`FliunoResultGroups`/`HighlightedText`。Modal 与 WorkspacePage 统一 `flattenFliunoPresentation` 拍平模型，「展示顺序 = 键盘导航顺序 = Enter 执行顺序」三序一致由 `FliunoModal.test.tsx` 与 `FliunoWorkspacePage.test.tsx` 双侧固化。
- **Bento 网格范式**：StorageSettingsSection 以 `grid-cols-1 sm:2 xl:3` 分类卡网格重组，总览行三卡（总占用/可安全清理聚合/CSS conic-gradient 占比环，radial mask 挖孔无图表库）；全部清理目标与开关保留，仅重排。
- **通知视觉收敛**：Toast 与通知中心统一「透明底彩色图标 + 左缘 3px 状态色条」，状态色收敛为 `--StatusSuccess/Error/Warning/Info` 四令牌（confirm 复用 primary）；Toast 表面挂 `glass-layer-overlay` 液态档。
- **供应链信任**：`MarketplaceService.installExtension` 在官方渠道（host = marketplace.aurona.cc，`isOfficialMarketplaceHost` 判定）要求响应携带 `X-Aurona-Extension-Sha256`，缺失即拒装；本地开发与自定义服务器豁免；Rust 侧 `install_package` SHA-256 校验保持不变。本地 sideload（.vsix/手动安装）不受此限。
- **vscodeCompatEnabled 解耦事实**：该开关为纯前端配置（仅控制安装入口 disabled），Rust 侧兼容层借用判定不看它；`runtime_for` 失败路径已拆分「兼容层包存在但 wasm 空 / 包不在注册表」双分支并输出 `[Extensions] 兼容层诊断` 结构化日志。

## V0.4.3 代理 / 窗口状态 / 液态玻璃材质

V0.4.3 聚焦「网络代理、窗口状态契约、圆角体系收敛与液态玻璃材质」；Fliuno 补齐分组渲染与搜索偏好持久化。不新增 SDK、Runtime 或 Marketplace 能力。

- **代理注入点**：前端为单一事实源。更新检查由 `UpdaterService` 读取 `UserConfigStore.network`，custom 模式经 `check({ proxy })` 直传 tauri-plugin-updater（检查与下载共用，运行时生效，无需重启；插件 check 命令不支持 no_proxy，故「不使用代理」仅对 Rust 侧工具链下载强制直连）；工具链下载经 `network::configure_client(reqwest::ClientBuilder)` 按全局 `OnceLock<RwLock<ProxyConfig>>` 修饰，`set_network_proxy` IPC 在启动与设置变更时同步。Marketplace 扩展下载走前端 fetch，明确不在覆盖范围。
- **窗口状态契约**：`UserConfig.windowState`（物理像素 + isMaximized）。关闭保护链在 `destroy()` 前采样 `saveWindowLayout()` 并 `UserConfigStore.flush()` 落盘（最小化窗口跳过采样）；启动恢复在主窗口 show 之前执行（防闪烁），按显示器工作区做边界钳制（可见余量 120px），无显示器信息等异常一律回退最大化。`@tauri-apps/api` 类型只允许出现在 Foundation/Desktop，`WindowLayoutManager` 消费纯数据投影（`MonitorArea` / `setPositionPhysical`）。
- **液态玻璃档体系**：`glassVariants` overlay 层挂 `glass-layer-overlay` 标记类；Theme.css 以 `--LiquidSpecular/--LiquidRim` 双令牌驱动顶缘 specular 高光带（::before，9s 微流动）与边缘 rim 折射描边（::after），伪元素 `z-index:-1` 压内容下方、随 `liquidTexture` 开关启停、强度乘 `--GlassOpacity-Multiplier` 与拟物三档联动；背景光场 5 层（3 radial 慢速群 + 1 conic 90s 旋转 + 1 远景呼吸），纯 GPU 合成并响应 `prefers-reduced-motion`。
- **圆角三档契约**：控件按高度归档——h-9/h-10 → `rounded-2xl`、h-8 → `rounded-xl`、h-7 及以下 → 胶囊 `rounded-full`（必要时加高）；`--radius-control` 8px → 12px；控件焦点环统一 muted 体系（与输入框一致），accent 仅保留强调态。表面类（Card/Modal）保持 radius-surface。
- **Fliuno 分组与偏好**：`SECTION_LABEL_KEYS` 统一分组标题，Modal 与 WorkspacePage 均按 SECTION_ORDER 分组渲染 sticky 组头（全局平铺索引与键盘导航/aria 一致）；Fliuno 大小写/正则默认值来自 `UserConfig`，Modal 与 WorkspacePage 的切换即时持久化并传入 FliunoCore；防抖统一 120ms；`FliunoCore.test.ts` 固化前缀路由、字段加权、模糊边界与高亮区间基线。

## V0.4.2 语言 / 终端 / 全局设计一致性

V0.4.2 第一批聚焦「界面语言、终端主题集成、全局输入框规范与深色主题表面分域」，并完成两处大文件结构拆分；不新增 SDK、Runtime 或 Marketplace 能力。

- **I18n locale 订阅契约**：`useLocale()` 返回的 `t` 引用随 locale 变化（`useCallback([locale])`），调用方把 `t` 放进 `useMemo`/`useCallback` 依赖即可正确失效重算；tab 标题与命令标题走 `titleKey` 优先、渲染时实时翻译，store 不缓存翻译终值。新增 de/it/ja 全量翻译，并由结构性测试遍历比较各语言与 zh-CN 的 key 树防止漏译。
- **终端主题集成**：`TerminalView` 的 ANSI 调色板完整从 CSS 变量读取（暗色块 12 色齐全），MutationObserver 同时监听 `class` 与 `data-accent`，明暗主题与强调色切换即时重建 xterm theme 并 refresh；终端宿主不再持有独立背景色，直接透出面板卡片表面。
- **输入框规范**：统一 `Input` 组件以 wrapper `focus-within` 驱动「淡灰高亮边框 + 14% 光晕」焦点语言（Marketplace 规范），三档尺寸（sm/md/lg）共享同一焦点与圆角体系；裸 `<input>` 收编为组件，overlay 弹层内部行以 embedded surface 保持一致焦点语言。
- **深色主题表面分域**：每个 `.dark[data-accent]` 段覆盖 `--EditorSurface`（同色相低饱和深底），暖色三主题（rose/coral/amber）深色背景渐变拉开明度层次，dark heavy 玻璃档 multiplier 0.42 → 0.55 恢复表面区分度。
- **编辑器体感与结构**：词删除（Ctrl+Backspace/Delete）复用词边界逻辑走 `commitEdit`；大幅视口跳转（翻页/Ctrl+End/搜索跳转）走 120ms rAF 缓动平滑滚动，打字保持瞬时；多光标下行操作降级主光标并提示。`useEditorCommit`（提交/撤销/多光标批量写路径）与 `useExternalSync` 从 AuronaEngine 抽出，Rust 端行级语法高亮引擎拆至独立 `highlight.rs` 模块（纯移动）。

## V0.4.1 编辑器手感与性能边界

V0.4.1 是编辑器内核的收敛版本：把「按键一致性」与「大文件响应」做扎实，不新增 SDK、Runtime 或 Marketplace 能力。

- **统一编辑提交点 (`commitEdit`)**：按键类编辑（Backspace/Delete/Enter/Tab/行操作）、IME 提交、搜索替换与多光标批量编辑全部经同一提交点完成「状态更新 → 撤销入栈 → IPC 落盘」，杜绝旁路写入导致的栈与视图失同步。
- **精确增量写盘**：提交点基于单连续差异区间（`diffText` 前后缀去除）只传输差异段给 Rust 内核；多光标批量编辑按降序坐标一次 `applyEdits` 批量应用，单 revision、单次 LSP didChange。
- **复合撤销操作 (Composite Operation)**：多光标批量编辑以单一复合操作入栈，撤销时逆序回放子操作、重做顺序回放，一步还原全部光标改动；连续纯插入仍在 500ms 合并窗口内合并。
- **光标可见性保障**：任何光标变化后统一执行可见性检查（纵向行级对齐 + 横向按实际前缀文本宽度），编辑、导航、撤销、替换全路径覆盖。
- **导航与配对能力**：Ctrl+←/→ 词级跳转（Unicode 感知）、Ctrl+Home/End、PageUp/PageDown、括号引号自动闭合与选区包裹、over-type 跳过；搜索匹配设置软上限防止大文件宽匹配拖垮渲染。

## Pioneer 6 首启体验与生命周期边界

Pioneer 6 聚焦首启体验与退出生命周期：新增主程序内嵌的欢迎引导覆盖层（OOBE）与安装器三语选择器，落地退出清理队列；不新增 SDK、Runtime 或 Marketplace 后端能力。前端通过现有 `LanguageServerIPC`、`ToolchainsOverview` 和扩展清单表达既有能力。

- `GlassContainer` 的 `base`、`raised`、`overlay` 是唯一视觉层级；`Card` 只承载重复项目，页面分组不再叠加容器。欢迎引导复用同一套表面与主题令牌，不引入新的页面层级。
- 首次运行（无 `user-config.json`）时主窗口直接呈现全屏欢迎引导覆盖层，底层工作台并行启动；顶部栏与主程序统一（隐藏菜单项）。
- 软件退出遵循「前端与 WebView 先清理、窗口销毁后端再清理缓存」的顺序，WebView 缓存清理为有界等待的 best-effort 语义。
- Marketplace 的 `discover`、`installed`、`toolchains` 各自保存 query、filter、scrollTop 和 selected item；只有 Discover 的提交搜索会发起远程目录请求。
- 本地 LSP/Runtime 行只显示 IPC 与安装 manifest 的事实。缺少版本、大小、SHA-256 或下载地址时显示“信息不可用”，不得用市场统计或另一处版本猜测。
- Keep-Alive 仍由 Workspace 保持挂载，但非活动页面使用 `display: none` 移除 Canvas/WebView 组成表面。lazy chunk 失败由 `LazyChunkBoundary` 记录模块路径并提供重试/重新加载。

Aurona Code 采用自主研发的 **Corona+ 架构**。该架构的设计哲学为：**安全隔离、极致渲染、开放兼容、数据主权**。

系统基于 **Tauri 2 + React 19 + Rust + WASM Component Model (WASI P2)** 打造，彻底剔除了对 Electron 与 Monaco Editor 等重型框架的依赖，采用自研编辑器引擎（AuronaEngine），结合 **Radix UI** 无头交互组件与 **Tabler Icons** 纯净矢量图标体系，并以自研 **Glass 拟物毛玻璃材质系统** 构筑沉浸纯粹的现代桌面开发工作台。

---

## 1. Corona+ 核心设计原则

### 1.1 IPC 绝对隔离与权限守卫
- 前端 React 业务组件**严禁直接调用全局底层通信**；
- 所有跨进程调用必须经由 `Src/Foundation/IPC/` 强类型模块与 `DesktopTransport` 统一转发；
- 扩展与插件通信由 Rust 扩展沙箱与 Host API 强制拦截，进行工作区白名单与能力授权校验（Capability Security）。

### 1.2 高可靠事件总线驱动 (Resilient EventBus)
- 跨子系统通信统一采用全局 `EventBus`，支持强类型 `EventMap`；
- **单点故障隔离**：事件派发循环具备异常沙盒保护，单个组件监听器抛出异常不会中断全局事件流；
- **自清理生命周期**：支持 `EventBus.once()` 机制，单次执行后自动注销，防止临时回调函数的闭包内存泄漏。

### 1.3 严格单向依赖流 (Unidirectional Dependency Flow)
- 模块分层结构：`Foundation` (基建层) → `Core` (核心服务层) → `Features` (功能业务层) → `Layout` (骨架布局层) → `UI` (原子表现层)；
- 上层可依赖下层，底层严禁逆向依赖业务层；
- 设立自动化边界守护门禁（`check-desktop-boundaries` 与 `check-material-boundaries`）。

### 1.4 数据主权与物理彻底解耦 (Data Sovereignty)
- **程序安装目录保持 100% 纯净只读**；
- 外部下载的 WASM 扩展包（`extensions/`）、插件沙箱私有键值（`extension-storage/<id>/`）、权限配置（`extensions-permissions.json`）、用户偏好（`user-config.json`）与工作区状态（`workspace.json`）**统一物理保存在系统 APPDATA（`AppLocalData`）目录**；
- 「设置 - 空间管理」提供可视化磁盘占用度量、一键缓存清理与系统数据目录快捷入口。

---

## 2. 前端模块分层体系 (`Src/`)

```text
Src/
├── Foundation/             # 基石基建层
│   ├── Desktop/            # 跨端桌面桥接与 Transport 抽象
│   ├── IPC/                # 强类型 IPC 命令通道 (FS/Editor/Extension/Storage/Auth)
│   ├── EventBus/           # 强类型高韧性发布订阅总线 (异常隔离 / once 自销毁)
│   ├── Storage/            # 用户配置、工作区与历史记录持久化
│   ├── FeatureFlags/       # 双渠道物理特性开关系统 (Stable / Pioneer)
│   └── I18n/               # 三语 (zh-CN / zh-Hant / en) 国际化引擎
│
├── Core/                   # 核心服务单例与反应式注册表
│   ├── DocumentService.ts  # 文档全生命周期与 LSP 状态机
│   ├── WorkspaceService.ts # 工作区状态管理
│   ├── AccountService.ts   # Aurona Account OAuth/OIDC PKCE 认证
│   ├── StatusBar/          # StatusBarRegistry 动态状态栏注册表
│   ├── Fliuno/             # FliunoCore 统一命令/文件/符号/设置/扩展搜索内核
│   ├── Editor/             # EditorAdapter 全局编辑器抽象
│   ├── Language/           # LspClient 语言服务客户端
│   └── Settings/           # SettingRegistry 全局可搜索偏好注册表
│
├── Features/               # 可插拔业务功能模块
│   ├── Editor/             # AuronaEngine 自研虚拟滚动视口、Minimap、折叠、多光标
│   ├── Extensions/         # WASM 运行时宿主、VSCodeExtensionHost、AuronaSDKHost、市场
│   ├── Explorer/           # 工作区文件树与拖拽会话
│   ├── Fliuno/             # FliunoWorkspacePage 与全局检索弹窗
│   ├── Settings/           # 设置中心与空间管理、先锋特性控制台
│   ├── Terminal/           # Pty 集成终端
│   └── Account/            # 账户认证与个人中心
│
├── Layout/                 # 骨架布局层
│   ├── TitleBar.tsx        # 自定义窗口控制与菜单
│   ├── Sidebar.tsx         # 活动侧边栏
│   ├── StatusBar.tsx       # 基于 StatusBarRegistry 动态渲染的状态栏
│   └── Panel.tsx           # 底部输出/终端/诊断面板
│
└── UI/                     # 基础原子表现层
    ├── Core/               # GlassManager 现代拟物毛玻璃材质体系
    ├── Components/         # 基于 Radix UI 无头体系封装的原子组件 (Select/Switch/Modal/Menu)
    ├── Feedback/           # Toast, Tooltip, Alert 等反馈交互
    └── Icons/              # 基于 Tabler Icons 按需导入封装的 IconManager
```

---

## 3. WASM 扩展沙箱与双模兼容生态

### 3.1 WASI P2 沙箱模型
- 核心扩展编译为 `wasm32-wasip2` 组件，运行在 `Wasmtime` 虚拟机中；
- 施加 Fuel 燃料额度限制与内存保护，杜绝死循环与内存溢出；
- 扩展包物理安装实施 **SHA-256 端到端哈希强校验**，拦截任何篡改或传输损坏。

### 3.2 双模 UI 交互机制 (Dual UI Architecture)
- **模式 A：官方原生声明式组件 (Declarative Native UI)**：直接使用 Aurona 基于 Radix UI + Glass 拟物材质打造的原生声明式组件（`Select`、`Switch`、`Card`、`Button`、`Input`、`ProgressBar`），零额外体积开销；
- **模式 B：自定义 Webview 容器 (Custom Webview Host)**：全自主渲染 HTML/CSS/Canvas 视图。

### 3.3 扩展宿主兼容矩阵
1. **VS Code 兼容宿主 (`VSCodeExtensionHost`)**：
   - 完整模拟 `vscode.window`、`vscode.commands`、`vscode.workspace`、`vscode.env` 与 `Uri`、`Range`、`Position` 等标准 API；
2. **官方原生 Aurona SDK v1 (`AuronaSDKHost`)**：
   - 提供 `aurona.workspace`（文档与文本替换）、`aurona.ui`（拟物 Toast 与状态栏胶囊）、`aurona.storage`（独立 APPDATA 沙箱存储）与 `aurona.fliuno`（向全局搜索注入动态搜索源）。

---

## 4. 全局动态状态栏与 Fliuno 检索系统

### 4.1 动态状态栏系统 (`StatusBarRegistry`)
- 摆脱传统硬编码，支持核心、LSP、Git 与第三方扩展以声明式方式注册状态胶囊；
- 支持优先级排序、Tooltip 提示、点击回调与 `useSyncExternalStore` 响应式更新。

### 4.2 Fliuno 全局搜索中心 (`FliunoCore`)
- 支持全键盘驱动的极速检索，覆盖：
  - `>` 命令（Commands）
  - `@` 文件（Files）
  - `#` 符号（Symbols）
  - `:` 工作区内容（Content）
  - `!` 扩展插件动态项目（Extensions）
  - 设置项（Settings）
- 开放 `ExtensionFliunoRegistry`，允许插件动态贡献搜索源。

---

## 5. 后端 Rust 架构职责 (`src-tauri/`)

- **文本核心引擎**：基于 Ropey 维护大文本绳结构与版本修订链；
- **扩展运行时**：Wasmtime 实例池管理、Host API 派发与 APPDATA 路径注入；
- **系统接口桥接**：PTY 伪终端守护、LSP 子进程通信、真实系统剪贴板与文件系统监控；
- **窗口生命周期**：Splashscreen 最短展示后交棒主窗口；首次运行（无 user-config.json）时主程序直接呈现内置的全屏欢迎引导覆盖层（欢迎 → 语言 → 外观主题 → 账户登录，可跳过），顶部栏与主程序统一（隐藏菜单项），完整复用主程序主题系统，完成引导进入工作台，引导中关闭窗口即退出应用，高级设置支持重新运行；所有窗口销毁后执行有界等待的 WebView 缓存退出清理队列；
- **数据管理**：递归计算 APPDATA 真实物理占用，提供一键安全清理。

---

## 6. LSP 语言服务按需架构与共享运行时池 (Shared Runtime & Streaming Pipeline)

### 6.1 彻底解耦与按需分发
- **剔除主程序预置二进制**：主程序彻底不预装庞大的 Node.js 运行时与语言服务器，安装包体积大幅削减；
- **语言服务市场化分发**：官方 TypeScript、Pyright 等语言服务转为标准市场包，由客户端按需从 Aurona Marketplace 动态拉取。

### 6.2 共享公共运行时池 (Shared Node Runtime Pool)
- **单套运行时全局复用**：所有基于 Node.js 的 LSP 服务统一共享 APPDATA 中的单套精简公共运行时（`auronalabs.runtime-node`），杜绝重复占用磁盘空间；
- **智能依赖检测与确认**：安装依赖 Node 的 LSP 时，前端自动检测共享环境就绪状态，缺失时弹出依赖确认弹窗并协同下载。

### 6.3 异步流式下载流水线 (Streaming Download Pipeline)
- **防 OOM 内存保护**：Rust 端采用 `reqwest::Response::chunk()` 流式边下边写临时文件，彻底消灭全量内存缓冲造成的内存溢出；
- **实时进度事件广播**：通过 `toolchain://download_progress` IPC 通道向前端广播阶段与已下载百分比，驱动侧边栏微型环形进度与详情页科技感长条流光进度条。
