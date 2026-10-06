import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = process.env.TAURI_ENV_TARGET_TRIPLE;
const release = path.join(root, "src-tauri/target", target && target !== "x86_64-pc-windows-msvc" && target !== "x86_64-unknown-linux-gnu" ? target : "", "release/bundle");
const suffix = process.platform === "win32" ? ".exe" : process.platform === "darwin" ? ".app.tar.gz" : ".AppImage";
const files = fs.readdirSync(release, { recursive: true }).filter((file) => file.endsWith(suffix));
if (files.length !== 1) throw new Error(`Expected one ${suffix} updater artifact, found ${files.length}`);
const platform = process.platform === "win32" ? "windows-x86_64" : process.platform === "darwin" ? "darwin-aarch64,darwin-x86_64" : "linux-x86_64";
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const directory = path.join(root, "candidate", target || platform);
function prepare(file, destination, artifactPlatform, name) {
  fs.mkdirSync(destination, { recursive: true });
  const normalized = path.join(destination, name);
  fs.copyFileSync(file, normalized);
  if (!fs.existsSync(`${file}.sig`)) throw new Error("Built artifact is missing its signature");
  fs.copyFileSync(`${file}.sig`, `${normalized}.sig`);
  execFileSync(process.execPath, [path.join(root, "scripts/prepare-candidate.mjs"), normalized,
    destination, artifactPlatform, process.env.AURONA_CHANNEL || "stable"], { stdio: "inherit" });
}
const updaterName = process.platform === "win32" ? `AuronaCode-v${version}-x64-setup.exe`
  : process.platform === "darwin" ? `AuronaCode-v${version}-universal.app.tar.gz` : `AuronaCode-v${version}-amd64.AppImage`;
prepare(path.join(release, files[0]), directory, platform, updaterName);
const additionalSuffix = process.platform === "darwin" ? ".dmg" : process.platform === "linux" ? ".deb" : null;
if (additionalSuffix) {
  const additional = fs.readdirSync(release, { recursive: true }).filter((file) => file.endsWith(additionalSuffix));
  if (additional.length !== 1) throw new Error(`Expected one ${additionalSuffix} installer, found ${additional.length}`);
  const file = path.join(release, additional[0]);
  // Supplemental installers get their own signed metadata; they are not updater platforms.
  if (!fs.existsSync(`${file}.sig`)) {
    execFileSync(process.execPath, [path.join(root, "node_modules/@tauri-apps/cli/tauri.js"), "signer", "sign", file], { stdio: "pipe" });
  }
  const installerPlatform = process.platform === "darwin" ? "darwin-universal-dmg" : "linux-x86_64-deb";
  prepare(file, path.join(directory, "installer"), installerPlatform,
    process.platform === "darwin" ? `AuronaCode-v${version}-universal.dmg` : `AuronaCode-v${version}-amd64.deb`);
}
