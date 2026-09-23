import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGuest, PROJECT_ROOT, zipStore } from "./lib/extension-build-common.mjs";

const root = PROJECT_ROOT;
const guestDir = join(root, "Extensions", "auronalabs.planner");
const wasmPath = join(guestDir, "target", "wasm32-wasip2", "release", "aurona_planner.wasm");
const outputDir = join(root, "MarketplacePackages");
const outputPath = join(outputDir, "auronalabs.planner.aurx");

function main() {
  if (!existsSync(join(guestDir, "Cargo.toml"))) {
    if (existsSync(outputPath)) {
      console.log(
        `[build:planner] 源码目录不在本工作区，但产物已存在 (${outputPath})，直接跳过构建。`,
      );
      return;
    }
  }
  buildGuest({ guestDir, remapAlias: "/auronalabs-planner", outputPath });

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
    id: "auronalabs.planner",
    name: "任务面板",
    displayName: {
      "zh-CN": "任务计划",
      "zh-Hant": "任務計劃",
      en: "Task Planner",
    },
    description: "Visual task planner and test case checklist for Aurona Code",
    displayDescription: {
      "zh-CN": "可视化任务计划与测试用例清单看板",
      "zh-Hant": "視覺化任務計劃與測試用例清單看板",
      en: "Visual task planner and test case checklist for Aurona Code",
    },
    publisher: "auronalabs",
    version: "0.1.2",
    engine: { auronaCode: ">=0.3.12" },
    permissions: ["workspace.read", "workspace.readwrite", "clipboard.write"],
    changelog:
      "v0.1.2: 升级现代双行筛选排版（状态与优先级分离）、全新原地安全授权系统，全语言本地化增强。",
    runtime: { component: "extension.wasm" },
    sidebar: {
      title: "Planner",
      displayTitle: {
        "zh-CN": "计划看板",
        "zh-Hant": "計劃看板",
        en: "Planner",
      },
      icon: "assets/icon.svg",
    },
    view: { entry: "ui/index.html" },
    marketplace: {
      categories: ["Productivity", "Project Management"],
      tags: ["planner", "kanban", "tasks", "todo", "productivity"],
      author: "Aurona Code Team",
      homepage: "https://github.com/AuronaLabs/AuronaCode-Early",
      repository: "https://github.com/AuronaLabs/AuronaCode-Early",
      license: "MIT",
    },
  };
  manifest.displayDescription = {
    "zh-CN": "可视化任务规划与测试用例清单看板",
    "zh-Hant": "視覺化任務計劃與測試案例清單看板",
    en: "Visual task planner and test case checklist for Aurona Code",
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
  console.log(`auronalabs.planner.aurx 构建完成: ${aurx.length} bytes (${kilobytes} KiB)`);
  console.log(`输出: ${outputPath}`);
}

main();
