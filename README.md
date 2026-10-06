<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="96" />
  <h1>Aurona Code</h1>
  <p>基于 Tauri、React 和 Rust 的桌面代码编辑器</p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version" src="https://img.shields.io/badge/version-0.4.14-2563eb" />
    <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" />
  </p>
</div>

Aurona Code 使用自研 AuronaEngine 编辑器、Rust 文本模型和 WASI P2 扩展运行时。工作台提供文件浏览、Git、终端、语言服务、调试、Markdown 预览和 AI Assistant。

## 版本状态

当前正式版本为 **[0.4.14](https://github.com/AuronaLabs/AuronaCode-Early/releases/tag/v0.4.14)**，于 2026-10-07（北京时间）发布到 Stable。包含 50 项安全、稳定性与性能实现；尚未完成的完整验收与外部签名对接转入 **0.4.15**。原矩阵保留 **47 项验收中、3 项生产验证阻塞、0 项完成全部验收**，不把发布决定当成验收证据。

正式安装包由 Release 流程从通过 Quality 的 tag 重新构建，五种产物均已通过固定 Updater 公钥、SHA-256、版本和渠道验证，公开附件下载后再次复验通过。Marketplace 正式包及目录签名仍依赖外部服务，未签名远程安装继续阻断；测试签名只证明客户端协议。见[发布决定](Docs/0.4.14-Release-Decision.md)、[0.4.15 剩余计划](Docs/0.4.15-Carryover-Plan.md)和[验收报告](Docs/0.4.14-Acceptance-Report.md)。

## 工作台

- 编辑：虚拟视口、多光标、撤销/重做、查找替换、折叠和 Minimap；Markdown 预览直接读取编辑缓冲区。
- 项目：分页文件树、Fliuno 文件/命令/符号/内容检索、Git 状态、暂存、提交、分支和差异查看。
- 开发工具：集成 PTY 终端、LSP 语言服务和 DAP 调试；工具链在 Marketplace 的 Toolchains 模式管理。
- AI：多个配置档、Responses API、流式响应，以及带审批、工具调用和 checkpoint 的 Agent 任务。
- 扩展：原生 `.aurx` WASM 扩展和部分 VS Code API 兼容能力；兼容层不保证所有 `.vsix` 扩展可用。
- 界面：主题、窗口状态、首启引导与六种语言。语言键结构有检查，部分硬编码文案仍待清理。

安装包只包含 `aurona.vscode-compat` 和供手动安装测试的 VSCode Demo。Planner、语言服务及共享运行时通过 Marketplace 独立分发；Markdown 已内置预览，旧 Markdown 扩展用于存量迁移。市场服务与包可用性不由本仓库单独保证。

## 安全与恢复

文件、Git、LSP、DAP 和终端初始目录使用后端工作区授权。自定义 AI、本地工具、外部目录和未签名本地扩展需要明确批准；配置或工作区变化后原许可可能失效。普通 shell 中的 `cd` 和用户批准运行的程序不具有文件系统沙箱保证。

AI 密钥保存在系统密钥环，前端配置仅保存凭据 ID；旧配置迁移失败时暂停请求并允许重试。使用远程 AI 会向批准的服务发送请求中的代码和上下文。

远程安装要求固定可信公钥和有效签名；缺少正式签名时安装阻断。Git 全部丢弃先预览、确认并创建恢复记录；Agent 回滚核对修改后的指纹，后续人工编辑可能产生冲突。恢复机制不能替代独立备份。限额用于控制资源消耗，不能保证所有故障下都不会耗尽资源。协议、迁移及恢复范围见 [安全与迁移](Docs/0.4.14-Security-and-Migration.md)。

## 本地开发

需要 Node.js 22、pnpm **12.4.1**、Rust **1.95.0** 和 `wasm32-wasip2` target。Windows 需要 VS2022 C++ Build Tools；macOS/Linux 需要 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
pnpm install --frozen-lockfile
rustup target add wasm32-wasip2
pnpm run prepare:extensions
pnpm run tauri:dev
```

`pnpm run dev` 只启动前端预览，文件、终端等桌面能力需要 Tauri。

## 验证与候选

```sh
pnpm run prepare:extensions    # 重建并校验安装包内置资源
pnpm run quality:full          # 前端检查、测试、构建及本机 Rust 检查
pnpm run check:audit           # 50 项、12 节 Changelog 与版本一致性
pnpm run check:audit:release   # 冻结、批准的发布范围与逐项结转门禁
pnpm run check:audit:complete  # 原始 50 项完整验收与生产证据门禁
pnpm run build:candidate:local # 生成本地 Windows NSIS 候选
```

[Quality 工作流](.github/workflows/quality.yml)在 Linux 检查前端，并在 Windows/macOS/Linux 重建扩展、检查 Rust。`quality:full` 使用当前主机，不代替三平台 CI。桌面压力测试、故障注入和真实外部服务验收也需单独执行；完整验收门禁仍应失败，发布范围门禁只接受已记录的逐项结转。

正式 tag 对应提交 `6407f2d` 的 [Quality run 37499017927](https://github.com/AuronaLabs/AuronaCode-Early/actions/runs/37499017927)七个 job 全部通过：前端 417 项测试，三平台扩展与 Rust 门禁通过。Rust 单测 Windows 212 passed，Linux/macOS 各 213 passed，均为 0 failed、1 ignored。忽略测试依赖本地 Account/Auth 服务；这些结果不代表 50 项完整验收完成。

候选构建与上传、发布分离；正式发布必须先通过该提交的 Quality 和真实产物签名验证。具体构建、签名与发布结果见[发布前检查](Docs/0.4.14-Release-Preflight.md)。

## 文档

- [文档索引](Docs/README.md)
- [当前架构](Docs/Architecture.md)、[设计规范](Docs/Design-Principles.md)
- [扩展开发](Docs/Extension-Development.md)、[SDK 参考](Docs/Extension-SDK-Reference.md)
- [0.4.14 审计计划](Docs/0.4.14-Audit-Plan.md)、[状态矩阵](Docs/0.4.14-Implementation-Status.md)
- [发布决定](Docs/0.4.14-Release-Decision.md)、[0.4.15 剩余计划](Docs/0.4.15-Carryover-Plan.md)
- [历史记录](Docs/Archive/README.md)、[后续设计](Docs/Roadmap/README.md)

## 许可证

[AGPL-3.0](LICENSE)。
