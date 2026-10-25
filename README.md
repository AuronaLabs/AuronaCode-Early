<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="96" />
  <h1>Aurona Code</h1>
  <p><strong>Create Without Limits. · 创造无限可能</strong></p>
  <p>让工具融入创作，让想法成为现实。</p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/releases/tag/v0.4.17"><img alt="Version 0.4.17" src="https://img.shields.io/badge/version-0.4.17-2563eb" /></a>
    <a href="LICENSE"><img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" /></a>
  </p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/releases/tag/v0.4.17">下载 0.4.17</a> ·
    <a href="Docs/README.md">阅读文档</a> ·
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/issues">反馈问题</a>
  </p>
</div>

Aurona Code 是一款桌面代码编辑器，将编辑、搜索、Git、终端、调试、扩展与 AI 助手融入同一个工作台。我们希望工具更自然地参与开发，让你专注于代码，也享受把想法变成现实的过程。

## 0.4.17 · 静

减少打扰，理清边界，让日常开发回到自己的节奏。

**0.4.17「静」于 2026 年 10 月 25 日发布到 Stable。** 这一版聚焦已有能力的整理与打磨：

- **更清晰的架构**：整理 Corona+ 模块边界，改善启动、Git、扩展与通知的协作方式。
- **更连贯的工作流**：修复 Git 请求取消、正式包开发者工具和工作区授权时序问题。
- **更灵活的安全设置**：插件包与目录签名分别提供开关，默认保护与使用选择同时保留。
- **更完善的扩展基础**：改进运行会话、命令、状态存储、文档事件、树视图和 Webview 桥接。
- **更安静的界面**：重新整理首启引导，调整深色高亮、主题图标、Markdown 预览与双按钮胶囊。

[阅读本版更新](Docs/0.4.17-Release-Notes.md) · [查看实现与验证记录](Docs/0.4.17-Development-Plan.md)

## 在一个工作台里，顺着思路完成开发

| 能力 | 你可以做什么 |
| --- | --- |
| 编辑代码 | 使用多光标、查找替换、代码折叠、Minimap 和 Markdown 即时预览 |
| 浏览项目 | 管理文件、搜索内容与符号，在文件和命令之间快速切换 |
| 管理改动 | 查看 Git 状态与差异，暂存、提交和切换分支 |
| 运行与调试 | 使用集成终端、语言服务、调试器与工具链管理 |
| 协作思考 | 通过 AI Assistant 对话，审阅带审批与恢复记录的 Agent 操作 |
| 扩展工作台 | 安装原生 `.aurx` 扩展，使用已支持的 VS Code 兼容能力 |

VS Code 兼容层目前支持部分 API。具体能力与限制请参阅[兼容层能力矩阵](Docs/0.4.17-VSCode-Compatibility-Matrix.md)。

## 下载与开始使用

在 [0.4.17 Release](https://github.com/AuronaLabs/AuronaCode-Early/releases/tag/v0.4.17) 的 **Assets** 中选择适合系统的安装包：

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| Windows | x64 | `.exe` 安装程序 |
| macOS | Universal | `.dmg`；另提供 `.app.tar.gz` 更新归档 |
| Linux | x86_64 / amd64 | `.AppImage` 或 `.deb` |

安装后可通过首启引导选择语言与外观，再打开项目开始工作。工作区授权在主界面就绪后呈现；相关选项可在「设置 → 安全」中调整。

## 由你决定如何使用

默认保护、清楚的提示和独立的设置，共同构成 Aurona Code 的信任体验。插件签名、安装确认、执行确认与工作区授权分别管理；应用更新继续使用独立的发布签名校验。

AI 凭据保存在系统密钥环。使用远程 AI 时，请求中的代码和上下文会发送给你选择的服务。更多说明见[安全与信任](Docs/Security-and-Trust.md)。

## 参与 Aurona Code

欢迎分享使用体验、报告问题、改进文档，或提交经过验证的修复。

- [文档首页](Docs/README.md)：产品、架构、设计与扩展资料。
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
