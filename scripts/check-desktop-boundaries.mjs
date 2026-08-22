import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = fileURLToPath(new URL("../Src/", import.meta.url));
const tauriImportPrefixes = ["Foundation/Desktop/"];
const transportPrefixes = ["Foundation/Desktop/", "Foundation/IPC/"];
const sourceExtensions = new Set([".ts", ".tsx"]);

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const violations = [];
const transportViolations = [];
const layerViolations = [];

const allFiles = await collect(sourceRoot);

for (const file of allFiles) {
  const path = relative(sourceRoot, file).split(sep).join("/");
  const content = await readFile(file, "utf8");
  const isTestFile = /(?:^|\/)__tests__\/|\.test\.[^.]+$/.test(path);

  if (
    !isTestFile &&
    !tauriImportPrefixes.some((prefix) => path.startsWith(prefix)) &&
    (content.includes('from "@tauri-apps/') || content.includes("from '@tauri-apps/"))
  ) {
    violations.push(path);
  }

  if (
    !isTestFile &&
    !transportPrefixes.some((prefix) => path.startsWith(prefix)) &&
    /\b(?:invokeDesktop|listenDesktop)\b/.test(content)
  ) {
    transportViolations.push(path);
  }

  // Corona+ 架构单向依赖流规则检查
  if (!isTestFile) {
    const topLayer = path.split("/")[0];
    const importMatches = content.match(/import\s+.*?\s+from\s+['"](.*?)['"]/g) || [];

    for (const match of importMatches) {
      const fromTarget = match.match(/from\s+['"](.*?)['"]/)?.[1];
      if (fromTarget && fromTarget.startsWith(".")) {
        const resolvedPath = resolve(dirname(file), fromTarget);
        const resolvedRelative = relative(sourceRoot, resolvedPath).split(sep).join("/");
        const targetLayer = resolvedRelative.split("/")[0];

        // 规则 1: Foundation 严禁依赖上层 Core, Features, Layout, UI, State
        if (
          topLayer === "Foundation" &&
          ["Core", "Features", "Layout", "UI", "State"].includes(targetLayer)
        ) {
          layerViolations.push(
            `Foundation 违规逆向依赖 ${targetLayer}: ${path} -> ${resolvedRelative}`,
          );
        }

        // 规则 2: Core 严禁依赖 Features, Layout
        if (topLayer === "Core" && ["Features", "Layout"].includes(targetLayer)) {
          layerViolations.push(`Core 违规逆向依赖 ${targetLayer}: ${path} -> ${resolvedRelative}`);
        }

        // 规则 3: UI 原子组件层严禁逆向依赖 Features, Layout, State
        if (topLayer === "UI" && ["Features", "Layout", "State"].includes(targetLayer)) {
          layerViolations.push(`UI 违规逆向依赖 ${targetLayer}: ${path} -> ${resolvedRelative}`);
        }
      }
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `Direct Tauri imports must stay inside Src/Foundation/Desktop:\n${violations.join("\n")}`,
);
assert.deepEqual(
  transportViolations,
  [],
  `Desktop transport calls must stay inside typed Foundation/IPC clients:\n${transportViolations.join("\n")}`,
);
assert.deepEqual(
  layerViolations,
  [],
  `Corona+ unidirectional layer dependency violations found:\n${layerViolations.join("\n")}`,
);

console.log(`Corona+ desktop and layer boundary checks passed for ${relative(root, sourceRoot)}.`);
