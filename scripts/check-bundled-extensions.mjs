import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const expected = new Map([
  ["resources/extensions/", ["aurona.vscode-compat.aurx"]],
  ["resources/extensions-demo/", ["vscode-demo.vsix"]],
]);
const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const resources = config.bundle?.resources;
if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
  throw new Error("Tauri bundle resources must map the two approved extension directories");
}

const extensionMappings = Object.entries(resources).filter(
  ([source, target]) => source.includes("extensions") || String(target).includes("extensions"),
);
if (
  extensionMappings.length !== expected.size ||
  extensionMappings.some(([source, target]) =>
    !expected.has(source) || target !== source.replace("resources/", ""),
  )
) {
  throw new Error("Tauri extension resource mappings differ from the approved bundle layout");
}

for (const [directory, allowedNames] of expected) {
  const entries = readdirSync(join(root, "src-tauri", directory), { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (
    entries.some((entry) => !entry.isFile()) ||
    names.length !== allowedNames.length ||
    names.some((name, index) => name !== allowedNames[index])
  ) {
    throw new Error(`${directory} must contain only ${allowedNames.join(", ")}; found ${names.join(", ")}`);
  }
}

console.log("Bundled extension whitelist verified: VSCode compatibility and Demo only.");
