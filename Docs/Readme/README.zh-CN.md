<div align="center">
  <img src="../../public/logo.png" alt="Aurona Code" width="104" />
  <h1>Aurona Code</h1>
  <p><strong>创造永无止境</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version 0.5.0 Alpha1" src="https://img.shields.io/badge/version-0.5.0--alpha.1-2563eb" />
    <a href="../../LICENSE"><img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" /></a>
  </p>
</div>

[English](../../README.md) · **简体中文** · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

Aurona Code 是一款桌面代码编辑器，将编辑、搜索、Git、终端、调试、扩展和 AI 助手融入同一个工作台。

## 让想法自然成形

- **阅读与编辑** — 自研编辑器、紧凑文件列表、工作区搜索与语言服务。
- **审阅与运行** — Git 变更、并排与统一差异视图、集成终端与调试。
- **与 AI 协作** — 自选模型、任务对话、工具审阅、取消操作，以及支持范围内的文件恢复。
- **按习惯定制** — 主题、本地扩展包与统一的设置布局。

## 0.5.0 Alpha1

**当前版本为Aurona Code全新升级的过渡版本**

当前开发版本为 **0.5.0-alpha.1**。本阶段先精简现有流程、打磨基础体验，为后续大规模升级做好准备。

账号体系与在线扩展商店暂时移除。扩展管理当前支持本地导入 `.aurx`、`.vsix` 和工具链包。AI 服务仍可由用户自行配置使用；在线扩展浏览与包下载暂不提供。

0.5.0 正式发布前继续使用当前仓库，`0.4.x` 分支保留正式版 `v0.4.18`。

## 构建与运行

先按[贡献指南](../../.github/CONTRIBUTING.md)安装工具链与平台依赖，再从仓库根目录执行：

```sh
pnpm install --frozen-lockfile
rustup target add wasm32-wasip2
pnpm run tauri:dev
```

`pnpm run dev` 仅启动前端预览。文件、Git、终端和扩展宿主需要桌面运行时；准备内置扩展会重新生成扩展包。

常用检查：

```sh
pnpm run typecheck
pnpm run check
pnpm run test:frontend
pnpm run build
pnpm run check:docs
```

## 文档与参与贡献

[文档索引](../README.md) · [本地开发](../Guides/Local-Development.md) · [当前架构](../Architecture/README.md) · [扩展开发](../Guides/Extensions/README.md) · [安全与信任](../Guides/Security-and-Trust.md) · [实现与验证](../Development/0.5.0-alpha.1/Implementation.md)

问题反馈和功能讨论见[支持与帮助](../../.github/SUPPORT.md)；提交代码或文档前请阅读[贡献指南](../../.github/CONTRIBUTING.md)。当前技术指南以中文维护。

VS Code 兼容层只覆盖部分 API，不提供完整 Node.js 环境。使用远程 AI 时，选中的代码和上下文会发送给配置的服务商，具体边界见安全与扩展指南。

## 许可证

本仓库采用 **GNU AGPL-3.0**，详见 [LICENSE](../../LICENSE)。

© AuronaLabs
