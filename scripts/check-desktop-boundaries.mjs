import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeModules } from "./lib/source-boundaries.mjs";

const root = fileURLToPath(new URL("../Src/", import.meta.url));
async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collect(file));
    else if (/\.tsx?$/.test(file) && !/\.test\.tsx?$|\.d\.ts$/.test(file)) {
      result.push({ path: relative(root, file).replaceAll("\\", "/"), source: await readFile(file, "utf8") });
    }
  }
  return result;
}
const result = analyzeModules(await collect(root));
assert.deepEqual(result.violations, [], `Corona+ boundary violations:\n${result.violations.join("\n")}`);
assert.deepEqual(result.cycles, [], `Runtime dependency cycles:\n${JSON.stringify(result.cycles, null, 2)}`);
console.log(`Corona+ AST checks passed: ${result.modules} production modules, ${result.edges} runtime edges, zero cycles.`);
