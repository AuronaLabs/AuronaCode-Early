<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="112" />
  <h1>Aurona Code</h1>
  <p><strong>写代码这件事，值得一个更舒服的角落</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version" src="https://img.shields.io/badge/version-0.3.12-2563eb" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24c8db" />
    <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" />
  </p>
</div>

Aurona Code 是一款正在快速成长的桌面代码编辑器。它没有套用现成的网页内核，而是用 Rust 与自研编辑器引擎，从零搭一个「更安静、更克制、也更顺手」的开发角落。

> [!IMPORTANT]
> Aurona Code 仍处于早期快速迭代阶段。它已经可以支撑日常编辑、文件管理、Git、终端、Python/TypeScript 语言服务与基础调试，但生态和成熟度还不能和耕耘多年的编辑器相比。请为重要项目保留版本控制和备份，也欢迎你参与进来，把它打磨成想要的样子。

## 它和主流编辑器有什么不一样？

我们尽量不吹牛，说点实在的对比：

| 维度 | Aurona Code | VS Code 等主流编辑器 |
| --- | --- | --- |
| 编辑器内核 | 自研 AuronaEngine + Rust Rope，不依赖 Monaco/Electron | 成熟内核，插件生态庞大 |
| 资源占用 | 面向轻量的桌面原生路径，目标是更小的启动与内存占用 | 功能全面，但通常更重 |
| 语言能力 | 内置 Python / TypeScript 语言服务，正在逐步扩展 | 支持的语言和工具非常广泛 |
| 插件生态 | 尚未开放（0.4.0 规划中） | 海量扩展 |
| 隐私与账号 | 无遥测、无云端依赖，Aurona Account 完全可选 | 各家策略不同 |
| 开源程度 | AGPL-3.0，仓库、文档与决策过程开放 | 部分开源 |

一句话：**它不是来打败谁的，而是想证明「编辑器也可以长成另一种样子」**。现在的它还很年轻，恰好是参与和影响它成长的最好时机。

## 现在能做什么

- 写代码：自研编辑器、虚拟视口、语法高亮，Python 与 TypeScript 的补全、Hover、诊断开箱即用；
- 管项目：文件树、Git 常用流程、Fliuno 统一搜索（命令/文件/设置/符号/内容）、集成终端；
- 调试入门：断点、调用栈与变量查看；
- 长得好看：8 套双色渐变主题、深浅色模式、玻璃质感与可选的「流光」动效；
- 账户能力：可选的 Aurona Account 登录，头像与身份信息会出现在状态栏。
- 语言：简体中文、繁體中文 (Beta) 与 English (Beta)，切换即时生效并持久化。

## 当前能力

| 领域 | 状态 | 当前实现 |
| --- | --- | --- |
| 编辑器 | 已实现核心闭环 | AuronaEngine、Rust Rope、UTF-16 编辑、虚拟视口、Worker/Rust 高亮、撤销/重做、搜索/补全/Hover/诊断与 LSP 基础能力 |
| 文档可靠性 | 已实现基础保护 | revision、原子批次、磁盘指纹、临时文件替换、恢复快照和冲突拒绝覆盖 |
| 工作区 | 已实现 | 文件树、标签页、打开/保存、新建/重命名/删除、布局持久化、文件定位；文件操作由 Rust 授权会话与规范化路径校验 |
| Fliuno 统一搜索 | 已实现 | Quick 悬浮搜索 + Workspace 页面共用一套引擎；命令、文件、设置、符号与内容可搜，键盘优先；旧全局搜索已下线 |
| Git | 已实现常用流程 | 状态、暂存/取消暂存、提交、历史、提交 Diff、分支管理、Fetch/Pull/Push；子进程纳入受保护进程组 |
| 终端 | 已实现 | 基于 `portable-pty` 与 xterm.js 的本地 PTY 终端 |
| Fliuno 与命令系统 | 已实现命令范围 | 命令、文件、设置、符号与内容统一可搜；标题栏菜单、快捷键和 macOS 菜单共享命令 ID |
| 语言服务与调试 | 已实现基础闭环 | Python/TypeScript 语言服务、Hover/补全/诊断、DAP 会话、断点与变量查看 |
| Aurona Account | 已启用官方账户 | OAuth 2.1/OIDC、PKCE S256、动态本机回调、系统凭据库；开发与正式使用同一公开客户端 |
| 桌面更新 | 已实现代码路径 | 自动检查、手动检查、下载与安装；仍需随每次真实 Release 验证签名和更新链 |
| 主题与界面 | 已实现 | 8 套双色渐变主题 × 浅色/深色、拟物强度、界面密度、Aurona Material 语义 token 与「流光」动效 |
| 性能测试 | 已实现 | 六项基准（IPC/UI 帧调度/文件系统/编辑器内核/搜索/编码转换）、统计摘要、保存/删除/导出与本地排行 |
| 跨平台 | 构建已配置 | Windows、macOS、Linux CI；实际发布质量仍需逐平台和 DPI 手工验证 |

### 尚未实现或尚未完整闭环

- 插件市场、插件运行时和 VS Code 扩展兼容层。
- AI Command Center、云服务、协作服务和遥测上传。
- 完整的实时外部文件监听与统一冲突处理界面。
- 完整的多编辑器分栏、自定义编辑器运行时和全量文档投影 LRU。
- 覆盖全部 LSP、Worker 和异步请求的统一 revision 失效协议。

这些内容属于未来候选，不应被视为已交付功能。

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
python manager.py -v 0.3.12   # 非交互式同步工程版本
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
- [0.3.2 Release Notes](Docs/0.3.2-Release-Notes.md)
- [0.3.3 Release Notes](Docs/0.3.3-Release-Notes.md)
- [0.3.4 Release Notes](Docs/0.3.4-Release-Notes.md)
- [0.3.5 Release Notes](Docs/0.3.5-Release-Notes.md)
- [0.3.10 Release Notes](Docs/0.3.10-Release-Notes.md)
- [0.3.11 Release Notes](Docs/0.3.11-Release-Notes.md)
- [0.3.12 扩展技术调研](Docs/V0.3.12-Extension-Research.md)
- [0.3.12 扩展开发进度](Docs/V0.3.12-Extension-Progress.md)
- [0.3.4 编辑器与 Git 架构](Docs/architecture/0.3.4-editor-and-git.md)
- [0.3.4 Aurona Account 基础](Docs/architecture/0.3.4-aurora-account-foundation.md)
- [0.3.5 收口说明](Docs/architecture/0.3.5-hardening.md)
- [0.3.6 审查报告](Docs/0.3.6-Audit-Report.md)
- [0.3.6 性能报告](Docs/0.3.6-Performance-Report.md)
- [0.3.10 完整性审计](Docs/0.3.10-Completeness-Audit.md)
- [0.3.11 第一阶段审计](Docs/0.3.11-Phase1-Audit.md)
- [0.3.11 第二阶段视觉审计](Docs/0.3.11-Phase2-Visual-Audit.md)

## 参与贡献

Aurona Code 接受缺陷修复、可靠性改进、性能优化、文档和经过讨论的产品改进。涉及编辑器协议、桌面权限、状态所有权或大规模 UI 结构调整时，请先创建 Issue 说明问题、迁移路径和验证方案。

详细流程见 [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md)。提交安全问题时请遵循 [.github/SECURITY.md](.github/SECURITY.md)，不要在公开 Issue 中披露漏洞细节。

## 许可证

Aurona Code 使用 [GNU Affero General Public License v3.0](LICENSE)。
