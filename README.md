<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="112" />
  <h1>Aurona Code</h1>
  <p><strong>面向现代桌面开发体验的自研代码编辑器</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version" src="https://img.shields.io/badge/version-0.3.1-2563eb" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24c8db" />
    <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" />
  </p>
</div>

Aurona Code 不是 VS Code 的换皮项目。它以 Tauri 2、React 19 和 Rust 为基础，围绕自研的 **AuronaEngine**、Rust Rope 文档会话和桌面原生能力，探索一套更统一、更可控的现代代码编辑器架构。

> [!IMPORTANT]
> Aurona Code 仍处于早期快速迭代阶段。0.3.1 已具备可运行的编辑、文件、搜索、Git、终端和更新基础，但尚不适合替代成熟编辑器承担无法容忍数据风险的生产工作。请为重要项目保留版本控制和备份。

## 项目方向

- **自研编辑体验**：不依赖 Monaco、CodeMirror 或 VS Code 编辑器内核。
- **桌面优先**：文件系统、PTY、Git、窗口和更新器是核心能力，不是 Web 页面附加层。
- **可靠性优先**：revision、原子批量编辑、磁盘指纹和恢复快照共同保护文档状态。
- **统一操作模型**：菜单、快捷键和 Fliuno 复用同一套命令注册与执行路径。
- **Aurona Material**：以玻璃材质、清晰层级和高信息密度塑造独立的桌面视觉语言。
- **可演进边界**：业务代码通过类型化桌面接口访问 Tauri，降低 UI 与本地实现的耦合。

## 0.3.1 当前能力

| 领域 | 状态 | 当前实现 |
| --- | --- | --- |
| 编辑器 | 已实现核心闭环 | AuronaEngine、Rust Rope、UTF-16 编辑、虚拟视口、Worker/Rust 高亮、撤销/重做、搜索与 LSP 基础能力 |
| 文档可靠性 | 已实现基础保护 | revision、原子批次、磁盘指纹、临时文件替换、恢复快照和冲突拒绝覆盖 |
| 工作区 | 已实现 | 文件树、标签页、打开/保存、新建/重命名/删除、布局持久化和文件定位 |
| 全局搜索 | 已实现 | 工作区搜索、结果分组、跳转、请求 ID 与后端取消 |
| Git | 已实现常用流程 | 状态、暂存/取消暂存、提交、历史和提交 Diff 查看 |
| 终端 | 已实现 | 基于 `portable-pty` 与 xterm.js 的本地 PTY 终端 |
| Fliuno 与命令系统 | 已实现命令范围 | Fliuno 提供全局搜索入口，当前接入真实命令；标题栏菜单、快捷键和 macOS 菜单共享命令 ID |
| 桌面更新 | 已实现代码路径 | 自动检查、手动检查、下载与安装；仍需随每次真实 Release 验证签名和更新链 |
| 主题与界面 | 已实现 | 深色/浅色主题、拟物强度、界面密度、Aurona Material 组件和 reduced motion |
| 性能测试 | 已实现 | 多轮样本、统计摘要、环境可比性与按语义版本排序的本地排行 |
| 跨平台 | 构建已配置 | Windows、macOS、Linux CI；实际发布质量仍需逐平台和 DPI 手工验证 |

### 尚未实现或尚未完整闭环

- 插件市场、插件运行时和 VS Code 扩展兼容层。
- AI Command Center、云服务、协作服务和遥测上传。
- 完整的实时外部文件监听与统一冲突处理界面。
- 完整的多编辑器分栏、自定义编辑器运行时和全量文档投影 LRU。
- 覆盖全部 LSP、Worker 和异步请求的统一 revision 失效协议。

这些内容属于未来候选，不应被视为 0.3.1 已交付功能。

## 架构概览

```text
React UI / Features
        │
        ├── Zustand workbench/editor/terminal state
        ├── CommandRegistry
        └── EditorIPC document projection queue
        │
Foundation/Desktop + typed domain IPC
        │
Tauri 2 commands and events
        │
        ├── Rope editor / atomic save
        ├── filesystem / search / Git
        ├── PTY / LSP
        └── updater / performance
```

前端业务模块不得直接导入 `@tauri-apps/*`；桌面访问统一收口到 `Src/Foundation/Desktop`。更完整的所有权和数据流说明见 [架构文档](Docs/Architecture.md)。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面容器 | Tauri 2 |
| 本地内核 | Rust、Tokio、Ropey、portable-pty、sysinfo |
| 前端 | React 19、TypeScript、Vite 7 |
| 状态 | Zustand 5 |
| UI | Tailwind CSS 4、Radix UI、Tabler Icons、Aurona Material tokens |
| 编辑支持 | highlight.js Worker、自研虚拟渲染、LSP 进程桥接 |
| 终端 | xterm.js |
| 工程质量 | Biome、Vitest、React Testing Library、GitHub Actions |

## 开发环境

### 必需工具

- Node.js 22 或更高版本（CI 使用 Node.js 22）
- pnpm 11.13.0（版本由 `packageManager` 固定）
- Rust stable 工具链
- 当前平台所需的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)

Linux 构建还需要 GTK/WebKit 等系统库；仓库 CI 使用 Ubuntu 22.04，并安装 `pkg-config`、`libgtk-3-dev`、`libwebkit2gtk-4.1-dev`、`libappindicator3-dev`、`librsvg2-dev` 与 `patchelf`。

### 获取并运行

```powershell
git clone https://github.com/AuronaLabs/AuronaCode-Early.git
cd "AuronaCode-Early"
corepack enable
corepack install --global pnpm@11.13.0
pnpm install --frozen-lockfile
pnpm run tauri:dev
```

也可以使用可选的 Python 管理器：

```powershell
python -m pip install rich
python manager.py
```

`manager.py` 只是开发辅助入口，项目构建不依赖 Python。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm run tauri:dev` | 启动完整 Tauri 开发环境 |
| `pnpm run dev` | 仅启动 Vite 前端服务器 |
| `pnpm run build` | 类型检查并构建前端生产资源 |
| `pnpm run tauri:build` | 构建当前平台安装包 |
| `pnpm run typecheck` | TypeScript 类型检查 |
| `pnpm run check` | Biome 代码质量检查 |
| `pnpm run check:boundaries` | 检查业务层是否绕过桌面边界 |
| `pnpm run check:materials` | 检查业务组件是否绕过 Material 边界 |
| `pnpm run smoke` | 校验版本、更新历史与发布元数据 |
| `pnpm run test:frontend` | 运行前端单元与组件测试 |
| `pnpm run test:rust` | 运行 Rust 测试 |

## 提交前验证

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run check
pnpm run check:boundaries
pnpm run check:materials
pnpm run smoke
pnpm run test:frontend
pnpm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
git diff --check
```

如果 Windows 普通终端无法找到 MSVC linker，请先进入 Visual Studio Build Tools 的开发者命令环境，再运行 Rust 检查或 Tauri 构建。

## 仓库结构

```text
Aurona Code/
├── Src/             # React、编辑器、工作台与 UI
├── src-tauri/       # Rust 内核、Tauri commands 与权限
├── Docs/            # 架构、设计、文件树、性能与版本文档
├── scripts/         # smoke、边界检查和发布日志生成
├── .github/         # CI、发布工作流与协作模板
├── manager.py       # 可选的交互式开发管理器
└── package.json     # pnpm 脚本与前端依赖
```

详细到模块和关键文件的结构见 [Docs/FileTree.md](Docs/FileTree.md)。

## 文档索引

- [架构与数据流](Docs/Architecture.md)
- [完整文件树](Docs/FileTree.md)
- [Aurona Material 设计原则](Docs/DesignPrinciples.md)
- [产品方向与明确边界](Docs/ProductVision.md)
- [0.3.0 技术说明](Docs/0.3.0-TechnicalNotes.md)
- [0.3.0 执行记录](Docs/0.3.0-Execution-Plan.md)
- [0.3.0 性能报告](Docs/0.3.0-Performance-Report.md)
- [0.3.0 Release Notes](Docs/0.3.0-Release-Notes.md)
- [0.3.1 Release Notes](Docs/0.3.1-Release-Notes.md)

## 参与贡献

Aurona Code 接受缺陷修复、可靠性改进、性能优化、文档和经过讨论的产品改进。涉及编辑器协议、桌面权限、状态所有权或大规模 UI 结构调整时，请先创建 Issue 说明问题、迁移路径和验证方案。

详细流程见 [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md)。提交安全问题时请遵循 [.github/SECURITY.md](.github/SECURITY.md)，不要在公开 Issue 中披露漏洞细节。

## 许可证

Aurona Code 使用 [GNU Affero General Public License v3.0](LICENSE)。
