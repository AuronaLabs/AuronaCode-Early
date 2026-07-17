import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = fileURLToPath(new URL("../Src/", import.meta.url));
const allowedPrefixes = ["Foundation/Desktop/"];
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
for (const file of await collect(sourceRoot)) {
  const path = relative(sourceRoot, file).split(sep).join("/");
  if (allowedPrefixes.some((prefix) => path.startsWith(prefix))) continue;
  const content = await readFile(file, "utf8");
  if (content.includes('from "@tauri-apps/') || content.includes("from '@tauri-apps/")) {
    violations.push(path);
  }
}

assert.deepEqual(
  violations,
  [],
  `Direct Tauri imports must stay inside Src/Foundation/Desktop:\n${violations.join("\n")}`,
);
console.log(`Desktop boundary check passed for ${relative(root, sourceRoot)}.`);
