# Aurona Code 架构设计与运行时边界

本文档描述 **Aurona Code** 的核心设计原则、模块边界、数据流模型与扩展沙箱架构。

---

## 1. 核心设计原则

1. **Rust 为数据权威**：文档 Rope、文件系统、版本控制与扩展沙箱均以 Rust 为权威状态源；前端负责视图投影与乐观交互。
2. **轻量与可控**：不依赖 Monaco/Electron 等重型框架，自研虚拟视口编辑器与分层渲染引擎。
3. **零信任安全隔离**：扩展插件运行于 WebAssembly Component 沙箱中，受 Fuel/Memory 硬预算与细粒度权限管控，严禁未授权的文件或网络访问。
4. **分层材质与原生质感**：基于 Aurona Material 规范，通过语义 Token 与拟物玻璃档位构建高品质桌面体验。

---

## 2. 系统全景架构

```text
React UI / Features Layer
  ├── AuronaEngine (自研虚拟视口编辑器核心 + 渐进式 Hooks 拆分)
  ├── Fliuno (统一命令、文件、设置、符号与内容搜索中心)
  ├── Workspace / Layout (ActivityBar, Sidebar, Panels, Status Bar)
  ├── Extensions View Host (Sandboxed Plugin WebView / Iframe)
  └── Foundation (I18n, EventBus, Storage, Desktop IPC Bridge)
        │
        ▼ (Tauri IPC / Type-Safe Commands)
Rust Core Layer
  ├── EditorEngine (Ropey, Revision, Highlights, Undo/Redo, Atomic Batches)
  ├── ExtensionRuntime (Wasmtime 47.x, Component Model, Fuel/Memory Limits)
  ├── Workspace / FileSystem (Security boundary verification & session locks)
  ├── Toolchains / LSP / DAP (TypeScript, Python, DAP Debug Sessions)
  ├── ProcessService (Windows Job Objects / Unix Process Groups)
  └── Performance / Diagnostics (Benchmarks & Telemetry)
```

---

## 3. 编辑器数据流与权威协议

```text
keyboard / IME / paste
        │
optimistic frontend projection (useEditorIME / useEditorPointerSelection)
        │
operation history + in-flight batch per document
        │
apply_editor_edits(baseRevision, clientBatchId, edits)
        │
clone Rope -> sequential edits -> atomic session commit
        │
revision acknowledgement or conflict rejection
```

1. **原子批次与 Revision 递增**：单批编辑无论包含多少局部操作，仅递增一次 revision；任何单项失败均原子回滚。
2. **落盘安全**：写入临时文件、同步落盘、校验磁盘指纹后原子替换，防止覆盖冲突或损坏文件。
3. **前端投影与全量上限**：当前文档打开采用全量文本投影协议，单文件设立 32 MiB 安全上限；分页可编辑会话属于未来路线图。

---

## 4. Aurona Extensions 扩展体系与 WASM 沙箱架构

从 0.3.12 起，Aurona Code 引入了现代化的 **WebAssembly Component Model** 扩展体系（详见 [AURX 扩展开发指南](AURX-Extension-Development.md)）：

```
┌─────────────────────────────────────────────────────────────┐
│                      Aurona Code Host                       │
│  (Tauri / Rust Core: Document, Workspace, Theme, Window)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ 双向 WIT 契约绑定 (world.wit)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 WASM Component Sandbox                      │
│   • 物理内存硬上限: 64 MiB                                   │
│   • Fuel 单指令燃油预算: 10,000,000                         │
│   • 严格无本地文件系统逃逸 / 无网络 Socket                  │
└──────────────────────────────┬──────────────────────────────┘
                               │ 安全渲染 HTML 产物注入
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Sandboxed Iframe / Webview                    │
│   • Content-Security-Policy: default-src 'none'             │
│   • 禁止直接调用原生系统 API，禁止跨层访问主界面 DOM        │
└─────────────────────────────────────────────────────────────┘
```

- **AURX 扩展包规范**：内置扩展以标准 PKZip 格式打包，包含 `manifest.json`、`extension.wasm`、`ui/index.html` 与矢量图标。
- **细粒度权限控制**：
  - `editor.current.read`：授权后允许扩展获取当前活动文档快照与选区；
  - `workspace.read`：授权后允许扩展在严格防逃逸校验下只读访问工作区文件与目录。
- **UI 分层隔离**：扩展视图运行于隔离 Iframe 中，遵循严格 CSP 规范，仅通过宿主插槽注入渲染结果。

---

## 5. Rust 核心模块职责

| 模块路径 | 职责定位 |
| --- | --- |
| `editor.rs` | Rope 会话、UTF-16 偏移换算、revision、原子批量编辑、高亮与安全持久化 |
| `extensions/runtime.rs` | Wasmtime 47.x 运行时、Component Model 实例化、Fuel 燃油控制与 Host API 实现 |
| `extensions/aurx.rs` | AURX 扩展归档解包、条目路径安全防逃逸校验与 CRC32 完整性验证 |
| `extensions/registry.rs` | 扩展目录扫描、元数据发现与多路径回退加载机制 |
| `extensions/state.rs` | 扩展权限持久化、工作区域隔离与生命周期管理 |
| `extensions/commands.rs` | 扩展前端 Tauri IPC 接口分发与多语言/环境上下文注入 |
| `commands/fs.rs` | 工作区文件系统操作与授权会话校验 |
| `search.rs` | 工作区搜索引擎、Fliuno 检索、取消标记与资源回收 |
| `commands/git.rs` | Git 输入校验与受保护子进程组调度 |
| `pty.rs` | 本地 PTY 创建、输入输出流、尺寸同步与终端生命周期 |
| `lsp.rs` / `lsp_cmds.rs` | 语言服务器进程管理、LSP 协议转发与诊断通道 |
| `process_service.rs` | 统一跨平台受保护进程树（Windows Job Object / Unix 进程组） |
| `performance.rs` | 本地性能基准工作负载（IPC、UI、FS、Editor、Search、Encoding、WASM） |
| `lib.rs` | Tauri 插件生命周期与 Command 路由注册 |

---

## 6. UI 与 Material 系统

- `Theme.css` 定义 Canvas、Chrome、Panel、Surface、Overlay、Modal、Interactive 语义材质。
- `GlassManager` 管理深浅主题独立的 light/medium/heavy 拟物档位。
- `UI/Components` 提供 Button、Input、Switch、Select、ContextMenu、Modal 等复用原子组件。
- 业务状态颜色（Git addition/deletion、错误、警告）不替代容器材质层级。
- 键盘焦点必须可见；输入框由外层玻璃组件呈现焦点，避免双层蓝框。

---

## 7. 质量门禁体系

- TypeScript：`pnpm run typecheck`
- Biome：`pnpm run check`
- 桌面边界：`pnpm run check:boundaries`
- Material 边界：`pnpm run check:materials`
- 发布元数据：`pnpm run smoke`
- 前端测试：Vitest + React Testing Library (`pnpm run test:frontend`)
- Rust：fmt、clippy、check、test (`cargo test`)
- CI：GitHub Actions 前端 Ubuntu job + Windows/macOS/Linux Rust matrix

---

## 8. 当前架构演进与已知技术债务

- **`AuronaEngine.tsx` 渐进式拆分**：在 0.3.13 中已拆出 `useEditorIME`、`useEditorContextMenu`、`useEditorPointerSelection` 等子 Hooks，后续将继续拆分键盘快捷键映射与虚拟视口滚动逻辑。
- **文档分页编辑会话**：当前文档仍受 32 MiB 单文件上限约束，超大文件的真实按需分页会话属于后续版本演进目标。
- **第三方扩展生态**：当前阶段仅开放受控随应用分发的内置 AURX 扩展包，不开放不受信任的第三方外部插件市场。
