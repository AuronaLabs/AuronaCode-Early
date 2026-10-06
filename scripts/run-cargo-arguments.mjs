import { execFileSync } from "node:child_process";
import fs from "node:fs";
const args = JSON.parse(fs.readFileSync(process.env.AURONA_CARGO_ARGUMENT_FILE, "utf8"));
if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error("Invalid Cargo arguments");
execFileSync("cargo", args, { stdio: "inherit" });
