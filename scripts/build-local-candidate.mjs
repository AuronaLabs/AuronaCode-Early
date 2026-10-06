import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findVcvars64 } from "./lib/extension-build-common.mjs";
import { sourceProvenance } from "./lib/audit-provenance.mjs";

const root = path.resolve(import.meta.dirname, "..");
if (process.platform !== "win32") throw new Error("This local candidate workflow currently targets Windows NSIS.");
const vcvars = findVcvars64();
if (!vcvars) throw new Error("VS2022 Build Tools environment is required.");
const run = (script, args = []) => execFileSync(process.execPath, [path.join(root, script), ...args], { cwd: root, stdio: "inherit" });
run("node_modules/typescript/bin/tsc", ["--noEmit"]);
run("scripts/build-vscode-compat-extension.mjs");
run("scripts/verify-vscode-compat-extension.mjs");
run("scripts/build-vscode-demo-extension.mjs");
run("scripts/check-bundled-extensions.mjs");
run("scripts/check-audit-0.4.14.mjs");
const source = sourceProvenance(root);
run("node_modules/vite/bin/vite.js", ["build"]);
const output = path.join(root, "candidate", "windows-x86_64");
fs.mkdirSync(output, { recursive: true });
const signed = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH);
const overlay = { build: { beforeBuildCommand: "" }, bundle: { createUpdaterArtifacts: signed } };
const argumentsFile = path.join(output, "build-arguments.json");
fs.writeFileSync(argumentsFile, JSON.stringify(["build", "--ci", "--bundles", "nsis", "--config", JSON.stringify(overlay)]));
const helper = path.join(root, "scripts/run-tauri-arguments.mjs");
execSync(`call "${vcvars}" && "${process.execPath}" "${helper}"`, {
  cwd: root, stdio: "inherit", env: { ...process.env, AURONA_TAURI_ARGUMENT_FILE: argumentsFile },
});
fs.unlinkSync(argumentsFile);
const bundle = path.join(root, "src-tauri/target/release/bundle/nsis");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const files = fs.readdirSync(bundle).filter((file) => file.endsWith(".exe") && file.includes(version));
if (files.length !== 1) throw new Error(`Expected one current NSIS candidate; found ${files.length}.`);
if (source.sourceSha256 !== sourceProvenance(root).sourceSha256) {
  throw new Error("Source changed during candidate construction; candidate requires a clean rebuild.");
}
run("scripts/prepare-candidate.mjs", [path.join(bundle, files[0]), output, "windows-x86_64", "stable"]);
fs.writeFileSync(path.join(output, "build-provenance.json"), JSON.stringify({ ...source,
  builtAt: new Date().toISOString(), auditHarness: false,
  artifactSha256: JSON.parse(fs.readFileSync(path.join(output, "candidate-status.json"), "utf8")).artifactSha256,
}, null, 2));
