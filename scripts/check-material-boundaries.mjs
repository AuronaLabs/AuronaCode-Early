import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../Src/", import.meta.url));
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(path);
  }
}

await walk(root);
const violations = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  const name = relative(root, file).replaceAll("\\", "/");
  if (source.includes("bg-[var(--GlassSurface)]")) violations.push(`${name}: legacy GlassSurface background`);
  if (/<[a-z][^>]*\btitle\s*=/s.test(source)) violations.push(`${name}: native title attribute`);
}

assert.equal(violations.length, 0, `Material boundary violations:\n${violations.join("\n")}`);
console.log(`Material boundary check passed (${files.length} source files).`);
