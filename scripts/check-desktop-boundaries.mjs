import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
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
for (const file of await collect(sourceRoot)) {
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
console.log(`Desktop boundary check passed for ${relative(root, sourceRoot)}.`);
