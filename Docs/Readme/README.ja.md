<div align="center">
  <img src="../../public/logo.png" alt="Aurona Code" width="104" />
  <h1>Aurona Code</h1>
  <p><strong>創造に、限界はない。</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version 0.5.0 Alpha1" src="https://img.shields.io/badge/version-0.5.0--alpha.1-2563eb" />
    <a href="../../LICENSE"><img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" /></a>
  </p>
</div>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-Hant.md) · **日本語** · [Deutsch](README.de.md) · [Italiano](README.it.md)

Aurona Code は、編集、検索、Git、ターミナル、デバッグ、拡張機能、AI アシスタントを一つのワークベンチにまとめたデスクトップコードエディターです。

## アイデアを形にするワークベンチ

- **読む・書く** — 独自のエディター、コンパクトなファイル一覧、ワークスペース検索、言語サービス。
- **確認する・実行する** — Git の変更、並列・統合形式の差分、統合ターミナル、デバッグ。
- **AI と進める** — モデルの選択、タスクごとの会話、ツール操作の確認、キャンセル、対応する操作でのファイル復元。
- **自分に合わせる** — テーマ、ローカルの拡張パッケージ、統一された設定画面。

## 0.5.0 Alpha1

**このリリースは、Aurona Code の全面的なアップグレードに向けた移行版です。**

現在の開発バージョンは **0.5.0-alpha.1** です。Alpha1 では既存の操作を整理し、次の大規模なアップグレードに向けて基礎を磨いています。

アカウント機能とオンライン拡張ストアは一時的に削除しています。拡張機能はローカルの `.aurx`、`.vsix`、ツールチェーンパッケージから導入できます。AI サービスは利用者自身で設定して使えますが、オンラインでの拡張機能の閲覧やパッケージのダウンロードは提供していません。

0.5.0 の正式リリースまでは現在のリポジトリで開発を続けます。`0.4.x` ブランチには正式版 `v0.4.18` を保存しています。

## ビルドと実行

[貢献ガイド](../../.github/CONTRIBUTING.md)に従ってツールチェーンとプラットフォームの依存関係を用意し、リポジトリのルートで実行します。

```sh
pnpm install --frozen-lockfile
rustup target add wasm32-wasip2
pnpm run tauri:dev
```

`pnpm run dev` はフロントエンドのプレビューのみを起動します。ファイル操作、Git、ターミナル、拡張ホストにはデスクトップのランタイムが必要です。内蔵拡張機能の準備では、生成済みパッケージが再ビルドされます。

主なチェックコマンド：

```sh
pnpm run typecheck
pnpm run check
pnpm run test:frontend
pnpm run build
pnpm run check:docs
```

## ドキュメントと貢献

[ドキュメント一覧](../README.md) · [ローカル開発](../Guides/Local-Development.md) · [アーキテクチャ](../Architecture/README.md) · [拡張機能の開発](../Guides/Extensions/README.md) · [セキュリティと信頼](../Guides/Security-and-Trust.md) · [実装と検証の記録](../Development/0.5.0-alpha.1/Implementation.md)

不具合報告や機能の相談は[サポート](../../.github/SUPPORT.md)をご覧ください。コードや文書を変更する前に[貢献ガイド](../../.github/CONTRIBUTING.md)を確認してください。技術ガイドは現在、中国語で管理しています。

VS Code 互換レイヤーが対応する API は一部に限られ、完全な Node.js 環境は提供しません。リモート AI へのリクエストでは、選択したコードとコンテキストが設定先のプロバイダーに送信されます。詳細はセキュリティと拡張機能のガイドをご覧ください。

## ライセンス

**GNU AGPL-3.0** の下で公開しています。[LICENSE](../../LICENSE)をご覧ください。

© AuronaLabs
