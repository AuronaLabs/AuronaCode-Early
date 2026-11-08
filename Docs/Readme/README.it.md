<div align="center">
  <img src="../../public/logo.png" alt="Aurona Code" width="104" />
  <h1>Aurona Code</h1>
  <p><strong>Crea senza limiti.</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version 0.5.0 Alpha1" src="https://img.shields.io/badge/version-0.5.0--alpha.1-2563eb" />
    <a href="../../LICENSE"><img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" /></a>
  </p>
</div>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · **Italiano**

Aurona Code è un editor di codice desktop che riunisce modifica, ricerca, Git, terminali, debug, estensioni e un assistente IA in un unico ambiente di lavoro.

## Uno spazio per dare forma alle idee

- **Leggere e scrivere** — Un editor proprietario, un elenco file compatto, ricerca nell’area di lavoro e servizi linguistici.
- **Rivedere ed eseguire** — Modifiche Git, confronti affiancati o unificati, terminali integrati e debug.
- **Lavorare con l’IA** — Modelli configurabili, conversazioni per attività, verifica delle operazioni degli strumenti, annullamento e ripristino dei file nei flussi supportati.
- **Personalizzare** — Temi, pacchetti di estensioni locali e impostazioni con un’impaginazione coerente.

## 0.5.0 Alpha1

**Questa è una versione di transizione verso il rinnovamento completo di Aurona Code.**

La versione di sviluppo attuale è **0.5.0-alpha.1**. Alpha1 semplifica i flussi esistenti e migliora le basi in vista dei prossimi aggiornamenti importanti.

Il sistema di account e lo store online delle estensioni sono stati temporaneamente rimossi. È possibile importare pacchetti locali `.aurx`, `.vsix` e di toolchain. I servizi IA restano disponibili previa configurazione da parte dell’utente; la consultazione e il download delle estensioni online non sono disponibili.

Lo sviluppo prosegue in questo repository fino al rilascio ufficiale di 0.5.0. Il branch `0.4.x` conserva la versione ufficiale `v0.4.18`.

## Compilare e avviare

Installa le toolchain e le dipendenze di piattaforma indicate nella [guida ai contributi](../../.github/CONTRIBUTING.md), quindi esegui questi comandi dalla radice del repository:

```sh
pnpm install --frozen-lockfile
rustup target add wasm32-wasip2
pnpm run tauri:dev
```

`pnpm run dev` avvia soltanto l’anteprima del frontend. L’accesso ai file, Git, i terminali e l’host delle estensioni richiedono il runtime desktop. La preparazione delle estensioni incluse ricompila i pacchetti generati.

Controlli utili:

```sh
pnpm run typecheck
pnpm run check
pnpm run test:frontend
pnpm run build
pnpm run check:docs
```

## Documentazione e contributi

[Documentazione](../README.md) · [Sviluppo locale](../Guides/Local-Development.md) · [Architettura](../Architecture/README.md) · [Sviluppo di estensioni](../Guides/Extensions/README.md) · [Sicurezza e fiducia](../Guides/Security-and-Trust.md) · [Implementazione e verifiche](../Development/0.5.0-alpha.1/Implementation.md)

Per segnalare problemi o discutere nuove funzionalità, consulta il [supporto](../../.github/SUPPORT.md). Prima di modificare codice o documentazione, leggi la [guida ai contributi](../../.github/CONTRIBUTING.md). Le guide tecniche sono attualmente mantenute in cinese.

La compatibilità con le estensioni di VS Code copre solo parte delle API e non include un ambiente Node.js completo. Le richieste a servizi IA remoti inviano il codice e il contesto selezionati al fornitore configurato. I dettagli sono nelle guide alla sicurezza e alle estensioni.

## Licenza

Distribuito con licenza **GNU AGPL-3.0**. Vedi [LICENSE](../../LICENSE).

© AuronaLabs
