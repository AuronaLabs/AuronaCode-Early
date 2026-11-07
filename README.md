<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="96" />
  <h1>Aurona Code</h1>
  <p><strong>Create Without Limits. · 创造无限可能</strong></p>
  <p>让工具融入创作，让想法成为现实。</p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/releases/tag/v0.4.18"><img alt="Version 0.4.18" src="https://img.shields.io/badge/version-0.4.18-2563eb" /></a>
    <a href="LICENSE"><img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" /></a>
  </p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/releases/tag/v0.4.18">下载 0.4.18</a> ·
    <a href="Docs/README.md">阅读文档</a> ·
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/issues">反馈问题</a>
  </p>
</div>

Aurona Code 是一款桌面代码编辑器，将编辑、搜索、Git、终端、调试、扩展与 AI 助手融入同一个工作台。我们希望工具更自然地参与开发，让你专注于代码，也享受把想法变成现实的过程。

## 0.4.18 · 稳

让模块职责更清楚，让状态和资源各有归属，让变化留在边界之内。

**0.4.18「稳」于 2026 年 11 月 7 日发布到 Stable。** 本版围绕架构整理与运行稳定性推进：

- **明确模块边界**：整理 TypeScript 与 Rust 的工作区、文档、Git、调试、扩展和工作台职责。
- **修复异步状态问题**：改进工作区切换、文档保存、Git 操作、扩展会话、终端和持久化的生命周期处理。
- **统一主题与配置行为**：让配置写入、主题应用和插件视图共享清楚的状态更新入口。
- **完善工程检查**：加入文档链接、依赖边界和 Rust 领域边界检查，补充回归覆盖。

[阅读本版更新](Docs/Releases/0.4.18/Release-Notes.md) · [查看实现与验证记录](Docs/Development/0.4.18/Acceptance-Report.md)

## 工作台能力

| 能力 | 你可以做什么 |
| --- | --- |
| 编辑代码 | 使用多光标、查找替换、代码折叠、Minimap 和 Markdown 即时预览 |
| 浏览项目 | 管理文件、搜索内容与符号，在文件和命令之间快速切换 |
| 管理改动 | 查看 Git 状态与差异，暂存、提交和切换分支 |
| 运行与调试 | 使用集成终端、语言服务、调试器与工具链管理 |
| 协作思考 | 通过 AI Assistant 对话，审阅带审批与恢复记录的 Agent 操作 |
| 扩展工作台 | 安装原生 `.aurx` 扩展，使用已支持的 VS Code 兼容能力 |

VS Code 兼容层目前支持部分 API，不等同于完整 VS Code 或 Node.js 环境。具体能力与限制请参阅[兼容层能力矩阵](Docs/Releases/0.4.17/VSCode-Compatibility-Matrix.md)，本版未扩大其公开承诺范围。

## 下载与开始使用

在 [0.4.18 Release](https://github.com/AuronaLabs/AuronaCode-Early/releases/tag/v0.4.18) 的 **Assets** 中选择适合系统的安装包：

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| Windows | x64 | `.exe` 安装程序 |
| macOS | Universal | `.dmg`；另提供 `.app.tar.gz` 更新归档 |
| Linux | x86_64 / amd64 | `.AppImage` 或 `.deb` |

安装后可通过首启引导选择语言与外观，再打开项目开始工作。工作区授权在主界面就绪后呈现；相关选项可在「设置 → 安全」中调整。

## 安全与数据

默认保护、清楚的提示和独立的设置，共同构成 Aurona Code 的信任体验。插件签名、安装确认、执行确认与工作区授权分别管理；应用更新继续使用独立的发布签名校验。

AI 凭据保存在系统密钥环。使用远程 AI 时，请求中的代码和上下文会发送给你选择的服务。更多说明见[安全与信任](Docs/Guides/Security-and-Trust.md)。

## 参与贡献

欢迎分享使用体验、报告问题、改进文档，或提交经过验证的修复。

- [文档首页](Docs/README.md)：产品、架构、设计与扩展资料。
- [0.4.18「稳」交付记录](Docs/Development/0.4.18/Acceptance-Report.md)：本版架构迁移、自动化结果与未覆盖的桌面验收范围。
- [贡献指南](.github/CONTRIBUTING.md)：开发环境、验证流程与提交方式。
- [支持与帮助](.github/SUPPORT.md)：问题反馈与排查入口。
- [安全报告](.github/SECURITY.md)：私密报告安全问题。

## 0.5.0 预告

**Public Beta · Coming Soon**

Aurona Code 将从 **0.5.0** 开始进入公测，迁往新仓库 **[AuronaLabs/AuronaCode](https://github.com/AuronaLabs/AuronaCode/)**，并移除 Early 标签。新仓库将采用 **Apache License 2.0**。

这将是项目新的起点。更多信息、发布说明与文档将在后续公布，敬请期待。

## 许可证

本仓库中的 Aurona Code 采用 **GNU AGPL-3.0**，详见 [LICENSE](LICENSE)。新仓库的许可安排独立于本仓库。

---

**Aurona Code · 创造无限可能**

*Create Without Limits.*

© AuronaLabs
