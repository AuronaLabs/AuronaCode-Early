<div align="center">
  <img src="../../public/logo.png" alt="Aurona Code" width="104" />
  <h1>Aurona Code</h1>
  <p><strong>Kreativität ohne Grenzen.</strong></p>
  <p>
    <a href="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/AuronaLabs/AuronaCode-Early/actions/workflows/quality.yml/badge.svg" /></a>
    <img alt="Version 0.5.0 Alpha1" src="https://img.shields.io/badge/version-0.5.0--alpha.1-2563eb" />
    <a href="../../LICENSE"><img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-7c3aed" /></a>
  </p>
</div>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · **Deutsch** · [Italiano](README.it.md)

Aurona Code ist ein Desktop-Codeeditor, der Bearbeitung, Suche, Git, Terminals, Debugging, Erweiterungen und einen KI-Assistenten in einer gemeinsamen Arbeitsumgebung vereint.

## Eine Arbeitsumgebung für deine Ideen

- **Lesen und bearbeiten** — Ein eigener Editor, eine kompakte Dateiliste, Arbeitsbereichssuche und Sprachdienste.
- **Prüfen und ausführen** — Git-Änderungen, nebeneinander oder vereinheitlicht dargestellte Diffs, integrierte Terminals und Debugging.
- **Mit KI arbeiten** — Konfigurierbare Modelle, aufgabenbezogene Gespräche, überprüfbare Werkzeugaufrufe, Abbruch und Dateiwiederherstellung für unterstützte Abläufe.
- **Individuell anpassen** — Designs, lokale Erweiterungspakete und ein einheitlicher Aufbau der Einstellungen.

## 0.5.0 Alpha1

**Diese Version ist ein Übergang zur umfassenden Erneuerung von Aurona Code.**

Die aktuelle Entwicklungsversion ist **0.5.0-alpha.1**. Alpha1 vereinfacht bestehende Abläufe und verbessert die Grundlagen für die nächsten größeren Ausbauschritte.

Das Kontosystem und der Online-Erweiterungsshop wurden vorübergehend entfernt. Erweiterungen lassen sich derzeit aus lokalen `.aurx`-, `.vsix`- und Toolchain-Paketen importieren. Selbst konfigurierte KI-Dienste bleiben nutzbar; das Durchsuchen und Herunterladen von Erweiterungen im Internet wird derzeit nicht angeboten.

Bis zur offiziellen Veröffentlichung von 0.5.0 bleibt die Entwicklung in diesem Repository. Der Branch `0.4.x` bewahrt die offizielle Version `v0.4.18`.

## Bauen und starten

Installiere die in der [Anleitung zum Mitwirken](../../.github/CONTRIBUTING.md) beschriebenen Toolchains und Plattformabhängigkeiten. Führe anschließend im Stammverzeichnis des Repositorys Folgendes aus:

```sh
pnpm install --frozen-lockfile
rustup target add wasm32-wasip2
pnpm run tauri:dev
```

`pnpm run dev` startet nur die Frontend-Vorschau. Dateizugriff, Git, Terminals und der Erweiterungshost benötigen die Desktop-Laufzeit. Beim Vorbereiten der mitgelieferten Erweiterungen werden die erzeugten Pakete neu gebaut.

Nützliche Prüfungen:

```sh
pnpm run typecheck
pnpm run check
pnpm run test:frontend
pnpm run build
pnpm run check:docs
```

## Dokumentation und Mitarbeit

[Dokumentation](../README.md) · [Lokale Entwicklung](../Guides/Local-Development.md) · [Architektur](../Architecture/README.md) · [Erweiterungsentwicklung](../Guides/Extensions/README.md) · [Sicherheit und Vertrauen](../Guides/Security-and-Trust.md) · [Implementierung und Validierung](../Development/0.5.0-alpha.1/Implementation.md)

Für Fehlermeldungen und Funktionswünsche siehe [Support](../../.github/SUPPORT.md). Lies vor Änderungen an Code oder Dokumentation die [Anleitung zum Mitwirken](../../.github/CONTRIBUTING.md). Technische Anleitungen werden derzeit auf Chinesisch gepflegt.

Die VS-Code-Kompatibilität deckt nur einen Teil der APIs ab und bietet keine vollständige Node.js-Umgebung. Bei Anfragen an entfernte KI-Dienste werden ausgewählter Code und Kontext an den konfigurierten Anbieter gesendet. Einzelheiten stehen in den Sicherheits- und Erweiterungsanleitungen.

## Lizenz

Lizenziert unter **GNU AGPL-3.0**. Siehe [LICENSE](../../LICENSE).

© AuronaLabs
