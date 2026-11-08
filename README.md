<div align="center">
  <img src="public/logo.png" alt="Aurona Code" width="104" />
  <h1>Aurona Code</h1>
  <p><strong>Create Without Limits.</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version 0.5.0 Alpha1" src="https://img.shields.io/badge/version-0.5.0--alpha.1-2563eb" />
    <a href="LICENSE"><img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" /></a>
  </p>
</div>

**English** · [简体中文](Docs/Readme/README.zh-CN.md) · [繁體中文](Docs/Readme/README.zh-Hant.md) · [日本語](Docs/Readme/README.ja.md) · [Deutsch](Docs/Readme/README.de.md) · [Italiano](Docs/Readme/README.it.md)

Aurona Code is a desktop code editor that brings editing, search, Git, terminals, debugging, extensions, and an AI assistant into one workbench.

## A workbench for your ideas

- **Read and edit** — A custom editor, a compact file explorer, workspace search, and language services.
- **Review and run** — Git changes, side-by-side or unified diffs, integrated terminals, and debugging.
- **Work with AI** — Configurable model profiles, task conversations, tool review, cancellation, and file recovery within supported workflows.
- **Make it yours** — Themes, local extension packages, and a shared settings layout.

## 0.5.0 Alpha1

**This release is a transition toward a fully upgraded Aurona Code.**

The current development version is **0.5.0-alpha.1**. Alpha1 simplifies existing flows and improves the foundations before the next major round of upgrades.

The account system and online extension store have been temporarily removed. Extension management currently supports local `.aurx`, `.vsix`, and toolchain packages. AI services remain available when configured by the user; online extension browsing and package downloads are unavailable.

Development continues in this repository until the formal 0.5.0 release. The `0.4.x` branch preserves the formal `v0.4.18` release.

## Build and run

Install the toolchains and platform dependencies listed in the [contributing guide](.github/CONTRIBUTING.md), then run from the repository root:

```sh
pnpm install --frozen-lockfile
rustup target add wasm32-wasip2
pnpm run tauri:dev
```

`pnpm run dev` starts the frontend only. File access, Git, terminals, and the extension host require the desktop runtime. Preparing bundled extensions rebuilds their generated packages.

Useful checks:

```sh
pnpm run typecheck
pnpm run check
pnpm run test:frontend
pnpm run build
pnpm run check:docs
```

## Documentation and contribution

[Documentation](Docs/README.md) · [Local development](Docs/Guides/Local-Development.md) · [Architecture](Docs/Architecture/README.md) · [Extension development](Docs/Guides/Extensions/README.md) · [Security and trust](Docs/Guides/Security-and-Trust.md) · [Implementation and validation](Docs/Development/0.5.0-alpha.1/Implementation.md)

For bug reports and feature discussions, see [support](.github/SUPPORT.md). To contribute code or documentation, read [contributing](.github/CONTRIBUTING.md). Technical guides are currently maintained in Chinese.

VS Code extension compatibility covers a subset of APIs and does not include a full Node.js environment. Remote AI requests send the selected code and context to your configured provider. See the security and extension guides for details.

## License

Licensed under **GNU AGPL-3.0**. See [LICENSE](LICENSE).

© AuronaLabs
