import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGuest, PROJECT_ROOT, zipStore } from "./lib/extension-build-common.mjs";

const root = PROJECT_ROOT;
const guestDir = join(root, "Extensions", "auronalabs.markdown");
const wasmPath = join(guestDir, "target", "wasm32-wasip2", "release", "aurona_markdown.wasm");
const outputDir = join(root, "MarketplacePackages");
const outputPath = join(outputDir, "auronalabs.markdown.aurx");

function main() {
  if (!existsSync(join(guestDir, "Cargo.toml"))) {
    if (existsSync(outputPath)) {
      console.log(
        `[build:markdown] 源码目录不在本工作区，但产物已存在 (${outputPath})，直接跳过构建。`,
      );
      return;
    }
  }
  buildGuest({ guestDir, remapAlias: "/auronalabs-markdown", outputPath });

  const wasm = readFileSync(wasmPath);
  if (wasm.length < 4 || wasm.subarray(0, 4).toString("binary") !== "\0asm") {
    throw new Error(`无效的 WASM 产物: ${wasmPath}`);
  }
  const view = readFileSync(join(guestDir, "ui", "index.html"), "utf8");
  if (!view.includes("Content-Security-Policy")) {
    throw new Error("插件 UI 缺少 CSP meta");
  }
  if (!view.includes("<!--AURONA_RENDER_SLOT-->")) {
    throw new Error("插件 UI 缺少渲染槽位 <!--AURONA_RENDER_SLOT-->");
  }
  const icon = readFileSync(join(guestDir, "assets", "icon.svg"), "utf8");

  const manifest = {
    packageVersion: 1,
    id: "auronalabs.markdown",
    name: "Markdown 预览",
    displayName: { "zh-CN": "Markdown 预览", "zh-Hant": "Markdown 預覽", en: "Markdown Preview" },
    description: "Live Markdown preview with structured outline and diagnostics",
    displayDescription: {
      "zh-CN": "实时渲染 Markdown 文档并提供结构化大纲与诊断",
      "zh-Hant": "即時轉譯 Markdown 文件並提供結構化大綱與診斷",
      en: "Live Markdown preview with structured outline and diagnostics",
    },
    publisher: "auronalabs",
    version: "0.1.2",
    engine: { auronaCode: ">=0.3.12" },
    permissions: ["editor.current.read"],
    changelog:
      "v0.1.2: 适配全新非侵入式原地权限系统，升级三语国际化 (i18n)，全面提升大文档实时渲染性能。",
    runtime: { component: "extension.wasm" },
    sidebar: {
      title: "Markdown",
      displayTitle: {
        "zh-CN": "Markdown 预览",
        "zh-Hant": "Markdown 預覽",
        en: "Markdown Preview",
      },
      icon: "assets/icon.svg",
    },
    view: { entry: "ui/index.html" },
    marketplace: {
      categories: ["Programming Languages", "Formatters"],
      tags: ["markdown", "preview", "gfm", "wasm"],
      author: "Aurona Code Team",
      homepage: "https://github.com/AuronaLabs/AuronaCode-Early",
      repository: "https://github.com/AuronaLabs/AuronaCode-Early",
      license: "MIT",
    },
  };
  manifest.displayDescription = {
    "zh-CN": "实时渲染 Markdown 文档，提供结构大纲与诊断信息",
    "zh-Hant": "即時呈現 Markdown 文件，提供結構大綱與診斷資訊",
    en: "Live Markdown preview with structured outline and diagnostics",
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const normalizedView = view.replace(/\r\n/g, "\n");
  const normalizedIcon = icon.replace(/\r\n/g, "\n");

  const aurx = zipStore([
    ["manifest.json", manifestBytes],
    ["extension.wasm", wasm],
    ["ui/index.html", Buffer.from(normalizedView, "utf8")],
    ["assets/icon.svg", Buffer.from(normalizedIcon, "utf8")],
  ]);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, aurx);

  const kilobytes = (aurx.length / 1024).toFixed(1);
  console.log(`auronalabs.markdown.aurx 构建完成: ${aurx.length} bytes (${kilobytes} KiB)`);
  console.log(`输出: ${outputPath}`);
}

main();
