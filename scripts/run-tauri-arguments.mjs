import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const args = JSON.parse(fs.readFileSync(process.env.AURONA_TAURI_ARGUMENT_FILE, "utf8"));
if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error("Invalid Tauri arguments");
execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url)), ...args], { stdio: "inherit" });
