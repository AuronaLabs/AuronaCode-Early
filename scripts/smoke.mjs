import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const cargoToml = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const cargoLock = await readFile(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
const changelog = await readFile(
  new URL("../Src/Features/Settings/ChangelogData.ts", import.meta.url),
  "utf8",
);
const security = await readFile(new URL("../.github/SECURITY.md", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];
assert.ok(cargoVersion, "Cargo.toml must declare a package version");
assert.equal(tauriConfig.version, packageJson.version, "Tauri and package versions must match");
assert.equal(cargoVersion, packageJson.version, "Cargo and package versions must match");
const lockVersion = cargoLock.match(
  /\[\[package\]\]\s*\nname = "aurona_code"\s*\nversion = "([^"]+)"/,
)?.[1];
assert.equal(lockVersion, packageJson.version, "Cargo.lock and package versions must match");
assert.match(
  security,
  new RegExp(`\\|\\s*${packageJson.version.replaceAll(".", "\\.")}\\s*\\|\\s*:white_check_mark:`),
  "SECURITY supported version must match the package version",
);
assert.match(
  readme,
  new RegExp(`img\\.shields\\.io/badge/version-${packageJson.version.replaceAll(".", "\\.")}-`),
  "README version badge must match the package version",
);
assert.match(changelog, new RegExp(`version: "V${packageJson.version.replaceAll(".", "\\.")}"`));
const currentEntry = changelog
  .split(`version: "V${packageJson.version}"`)[1]
  ?.split(/\n\s*\{\n\s*version: "V/)[0];
assert.ok(currentEntry, "Current changelog entry must be readable");
const currentSectionCount = [...currentEntry.matchAll(/^\s{8}title:/gm)].length;
assert.equal(currentSectionCount, 4, "0.3.1 changelog must contain exactly four sections");
assert.equal(
  currentSectionCount % 2,
  0,
  "Changelog section count must stay even for the update-card layout",
);
assert.equal(
  tauriConfig.app.windows.find((window) => window.label === "main")?.dragDropEnabled,
  false,
  "The main WebView must leave HTML5 drag and drop to the application",
);

console.log(`Aurona Code ${packageJson.version} release metadata smoke check passed.`);
