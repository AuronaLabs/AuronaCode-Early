# Aurona Code 核心架构指南 (Corona+ Architecture Specification)

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
2. **官方原生 Aurona SDK v1.1 (`AuronaSDKHost`)**：
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
