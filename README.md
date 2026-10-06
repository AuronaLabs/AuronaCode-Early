<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="96" />
  <h1>Aurona Code</h1>
  <p>基于 Tauri、React 和 Rust 的桌面代码编辑器</p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Development version" src="https://img.shields.io/badge/version-0.4.14-2563eb" />
    <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" />
  </p>
</div>

Aurona Code 使用自研 AuronaEngine 编辑器、Rust 文本模型和 WASI P2 扩展运行时。工作台提供文件浏览、Git、终端、语言服务、调试、Markdown 预览和 AI Assistant。

## 版本状态

当前开发版本为 **0.4.14**，尚未冻结或取得发布资格。50 项安全、稳定性与性能更新均有实现和验收记录：**47 项验收中、3 项生产验证阻塞、0 项完成全部验收**。自动测试通过不等于真实工作流和生产签名验收完成。

正式 Updater 密钥来源与签名、Marketplace 包及目录签名仍是发布前置条件；本仓库的测试签名只验证客户端协议。当前安装包是本地候选。完整证据和剩余工作见 [验收报告](Docs/0.4.14-Acceptance-Report.md)与[50 项状态矩阵](Docs/0.4.14-Implementation-Status.md)。

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
pnpm run check:audit:release   # 冻结、完整验收和生产证据发布门禁
pnpm run build:candidate:local # 生成本地 Windows NSIS 候选
```

[Quality 工作流](.github/workflows/quality.yml)在 Linux 检查前端，并在 Windows/macOS/Linux 重建扩展、检查 Rust。`quality:full` 使用当前主机，不代替三平台 CI。桌面压力测试、故障注入和真实外部服务验收也需单独执行；发布门禁目前应失败。

候选构建不创建 tag、上传、发布或推进渠道。签名和完整验收通过后才可评估正式发布。具体本地结果见[发布前检查](Docs/0.4.14-Release-Preflight.md)。

## 文档

- [文档索引](Docs/README.md)
- [当前架构](Docs/Architecture.md)、[设计规范](Docs/Design-Principles.md)
- [扩展开发](Docs/Extension-Development.md)、[SDK 参考](Docs/Extension-SDK-Reference.md)
- [0.4.14 审计计划](Docs/0.4.14-Audit-Plan.md)、[状态矩阵](Docs/0.4.14-Implementation-Status.md)
- [历史记录](Docs/Archive/README.md)、[后续设计](Docs/Roadmap/README.md)

## 许可证

[AGPL-3.0](LICENSE)。
