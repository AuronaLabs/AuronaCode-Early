import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findVcvars64 } from "./lib/extension-build-common.mjs";
import { artifactSha256, sourceProvenance } from "./lib/audit-provenance.mjs";

const root = path.resolve(import.meta.dirname, "..");
if (process.platform !== "win32") throw new Error("This isolated WebView2 harness targets Windows.");
const vcvars = findVcvars64();
if (!vcvars) throw new Error("VS2022 Build Tools environment is required.");
const output = path.join(root, "candidate", "desktop-audit");
const source = sourceProvenance(root);
const workspace = path.join(output, "workspace");
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, ".aurona-audit-workspace"), "isolated-0.4.14-acceptance");
const config = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
const overlay = {
  identifier: "com.aurona.code.audit0414", productName: "Aurona Code Audit 0.4.14",
  build: { beforeBuildCommand: "" },
  bundle: { active: false, createUpdaterArtifacts: false },
  app: { windows: config.app.windows.map((window) => ({ ...window, dataDirectory: "audit0414-webview",
    additionalBrowserArgs: "--remote-debugging-port=9441" })) },
};
execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "build"], { cwd: root, stdio: "inherit" });
const taskFile = path.join(output, "build-arguments.json");
fs.writeFileSync(taskFile, JSON.stringify(["build", "--debug", "--no-bundle", "--features", "audit-harness", "--config", JSON.stringify(overlay)]));
try {
  execSync(`call "${vcvars}" && "${process.execPath}" "${path.join(root, "scripts/run-tauri-arguments.mjs")}"`, {
    cwd: root, stdio: "inherit", env: { ...process.env, AURONA_TAURI_ARGUMENT_FILE: taskFile },
  });
  fs.copyFileSync(path.join(root, "src-tauri/target/debug/Aurona Code.exe"), path.join(output, "Aurona Code Audit.exe"));
  if (source.sourceSha256 !== sourceProvenance(root).sourceSha256) {
    throw new Error("Source files changed during the audit build; rebuild before recording acceptance.");
  }
  fs.writeFileSync(path.join(output, "harness-config.json"), JSON.stringify({ ...overlay, workspace, candidateAcceptance: false }, null, 2));
  fs.writeFileSync(path.join(output, "build-provenance.json"), JSON.stringify({
    ...source, builtAt: new Date().toISOString(),
    artifactSha256: artifactSha256(path.join(output, "Aurona Code Audit.exe")),
  }, null, 2));
} finally { fs.unlinkSync(taskFile); }
console.log("Isolated audit binary built. It is not a release candidate or candidate-bundle acceptance evidence.");
