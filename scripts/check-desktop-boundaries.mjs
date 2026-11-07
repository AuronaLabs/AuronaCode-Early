import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeModules } from "./lib/source-boundaries.mjs";
import ts from "typescript";
import { checkRustDomainBoundaries } from "./lib/rust-domain-boundaries.mjs";

const root = fileURLToPath(new URL("../Src/", import.meta.url));
async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "Test") result.push(...await collect(file));
    else if (/\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(file)) {
      result.push({ path: relative(root, file).replaceAll("\\", "/"), source: await readFile(file, "utf8") });
    }
  }
  return result;
}
const configPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, join(root, ".."));
const domains = JSON.parse(await readFile(new URL("./data/source-domains.json", import.meta.url), "utf8"));
const result = analyzeModules(await collect(root), { root, compilerOptions: parsed.options, domains });
assert.deepEqual(result.violations, [], `Corona+ boundary violations:\n${result.violations.join("\n")}`);
assert.deepEqual(result.cycles, [], `Runtime dependency cycles:\n${JSON.stringify(result.cycles, null, 2)}`);
console.log(`Corona+ AST checks passed: ${result.modules} production modules, ${result.edges} runtime edges, zero cycles.`);

const rustRoot = fileURLToPath(new URL("../src-tauri/src/", import.meta.url));
async function collectRust(directory) {
  const modules = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) modules.push(...await collectRust(file));
    else if (entry.name.endsWith(".rs")) modules.push({ path: relative(rustRoot, file).replaceAll("\\", "/"), source: await readFile(file, "utf8") });
  }
  return modules;
}
const rustViolations = checkRustDomainBoundaries(await collectRust(rustRoot));
assert.deepEqual(rustViolations, [], `Rust domain boundary violations:\n${rustViolations.join("\n")}`);
console.log("Rust workspace/Git/editor/runtime domain guards passed.");
