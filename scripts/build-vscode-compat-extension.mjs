import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGuest, PROJECT_ROOT, zipStore } from "./lib/extension-build-common.mjs";

const root = PROJECT_ROOT;
const guestDir = join(root, "Extensions", "aurona.vscode-compat");
const wasmPath = join(guestDir, "target", "wasm32-wasip2", "release", "aurona_vscode_compat.wasm");
const outputDir = join(root, "src-tauri", "resources", "extensions");
const outputPath = join(outputDir, "aurona.vscode-compat.aurx");

function main() {
  buildGuest({ guestDir, remapAlias: "/aurona-vscode-compat", outputPath });

  const wasm = readFileSync(wasmPath);
  if (wasm.length < 4 || wasm.subarray(0, 4).toString("binary") !== "\0asm") {
    throw new Error(`无效的 WASM 产物: ${wasmPath}`);
  }
  // wasm32-wasip2 目标应直接产出组件编码（版本 13: 0x0d 0x00 0x01 0x00）。
  // 若产出核心模块（0x01 0x00 0x00 0x00），wasmtime 的组件 API 无法加载。
  const componentVersion = Buffer.from([0x0d, 0x00, 0x01, 0x00]);
  if (wasm.length < 8 || !wasm.subarray(4, 8).equals(componentVersion)) {
    throw new Error(
      "extension.wasm 不是 WebAssembly 组件（component）编码——请确认 wasm32-wasip2 工具链产出组件而非核心模块",
    );
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
    id: "aurona.vscode-compat",
    name: "VSCode Extension Compatibility Runtime",
    displayName: {
      "zh-CN": "VSCode 兼容层",
      "zh-Hant": "VSCode 相容層",
      en: "VSCode Compat",
    },
    description:
      "Shared WASM translation and execution runtime for VSCode extensions in Aurona Code",
    displayDescription: {
      "zh-CN": "Aurona Code 的 VSCode 扩展共用 WASM 转译与运行容器（第一阶段）",
      "zh-Hant": "Aurona Code 的 VSCode 擴充共用 WASM 轉譯與執行容器（第一階段）",
      en: "Shared WASM translation and execution runtime for VSCode extensions in Aurona Code",
    },
    publisher: "aurona",
    version: "0.1.0",
    engine: { auronaCode: ">=0.3.12" },
    runtime: { component: "extension.wasm" },
    sidebar: {
      title: "VSCode Compat",
      displayTitle: {
        "zh-CN": "VSCode 兼容",
        "zh-Hant": "VSCode 相容",
        en: "VSCode Compat",
      },
      icon: "assets/icon.svg",
    },
    view: { entry: "ui/index.html" },
    marketplace: {
      categories: ["Compatibility", "Developer Tools", "Transpilers"],
      tags: ["vscode", "compat", "transpiler", "wasm", "runtime"],
      author: "Aurona Code Team",
      homepage: "https://github.com/AuronaLabs/AuronaCode-Early",
      repository: "https://github.com/AuronaLabs/AuronaCode-Early",
      license: "MIT",
    },
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
  console.log(`aurona.vscode-compat.aurx 构建完成: ${aurx.length} bytes (${kilobytes} KiB)`);
  console.log(`输出: ${outputPath}`);
}

main();
