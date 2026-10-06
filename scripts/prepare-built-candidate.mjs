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
execFileSync(process.execPath, [path.join(root, "scripts/prepare-candidate.mjs"), path.join(release, files[0]), path.join(root, "candidate", target || platform), platform, process.env.AURONA_CHANNEL || "stable"], { stdio: "inherit" });
