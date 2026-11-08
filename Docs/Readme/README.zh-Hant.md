<div align="center">
  <img src="../../public/logo.png" alt="Aurona Code" width="104" />
  <h1>Aurona Code</h1>
  <p><strong>創造永無止境</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version 0.5.0 Alpha1" src="https://img.shields.io/badge/version-0.5.0--alpha.1-2563eb" />
    <a href="../../LICENSE"><img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" /></a>
  </p>
</div>

[English](../../README.md) · [简体中文](README.zh-CN.md) · **繁體中文** · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

Aurona Code 是一款桌面程式碼編輯器，將編輯、搜尋、Git、終端機、偵錯、擴充功能與 AI 助理整合在同一個工作台。

## 讓想法自在成形

- **閱讀與編輯** — 自研編輯器、緊湊的檔案清單、工作區搜尋與語言服務。
- **檢閱與執行** — Git 變更、並排與統一差異檢視、整合終端機與偵錯。
- **與 AI 協作** — 自選模型、任務對話、工具檢閱、取消操作，以及支援範圍內的檔案復原。
- **依習慣調整** — 佈景主題、本機擴充套件與一致的設定版面。

## 0.5.0 Alpha1

**目前版本是 Aurona Code 全新升級的過渡版本。**

目前開發版本為 **0.5.0-alpha.1**。此階段先精簡既有流程、改善基礎體驗，為後續大幅升級做好準備。

帳號系統與線上擴充商店暫時移除。擴充功能管理目前支援從本機匯入 `.aurx`、`.vsix` 與工具鏈套件。使用者仍可自行設定 AI 服務；目前不提供線上擴充瀏覽與套件下載。

0.5.0 正式發佈前繼續使用目前的儲存庫，`0.4.x` 分支保留正式版 `v0.4.18`。

## 建置與執行

先依[貢獻指南](../../.github/CONTRIBUTING.md)安裝工具鏈與平台相依套件，再從儲存庫根目錄執行：

```sh
pnpm install --frozen-lockfile
rustup target add wasm32-wasip2
pnpm run tauri:dev
```

`pnpm run dev` 只啟動前端預覽。檔案、Git、終端機與擴充宿主需要桌面執行環境；準備內建擴充功能時會重新產生套件。

常用檢查：

```sh
pnpm run typecheck
pnpm run check
pnpm run test:frontend
pnpm run build
pnpm run check:docs
```

## 文件與參與貢獻

[文件索引](../README.md) · [本機開發](../Guides/Local-Development.md) · [目前架構](../Architecture/README.md) · [擴充功能開發](../Guides/Extensions/README.md) · [安全與信任](../Guides/Security-and-Trust.md) · [實作與驗證](../Development/0.5.0-alpha.1/Implementation.md)

問題回報與功能討論請見[支援與協助](../../.github/SUPPORT.md)；提交程式碼或文件前，請閱讀[貢獻指南](../../.github/CONTRIBUTING.md)。目前技術指南以中文維護。

VS Code 相容層只涵蓋部分 API，不提供完整 Node.js 環境。使用遠端 AI 時，選取的程式碼與上下文會傳送至設定的服務商；詳細範圍請見安全與擴充指南。

## 授權條款

本儲存庫採用 **GNU AGPL-3.0**，詳見 [LICENSE](../../LICENSE)。

© AuronaLabs
