import { execFileSync, execSync } from "node:child_process";
import { findVcvars64 } from "./lib/extension-build-common.mjs";

const commands = [
  "cargo fmt --manifest-path src-tauri/Cargo.toml -- --check",
  "cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings",
  "cargo check --manifest-path src-tauri/Cargo.toml --locked",
  "cargo test --manifest-path src-tauri/Cargo.toml --locked",
];

if (process.platform === "win32") {
  const vcvars = findVcvars64();
  if (vcvars) {
    console.log(`[quality:rust] Loading VS BuildTools environment: ${vcvars}`);
    execSync(`call "${vcvars}" && ${commands.join(" && ")}`, { stdio: "inherit" });
  } else {
    console.warn("[quality:rust] vcvars64.bat was not found; using the current shell environment.");
    for (const command of commands) execSync(command, { stdio: "inherit" });
  }
} else {
  const cargoCommands = [
    ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"],
    ["clippy", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--all-targets", "--", "-D", "warnings"],
    ["check", "--manifest-path", "src-tauri/Cargo.toml", "--locked"],
    ["test", "--manifest-path", "src-tauri/Cargo.toml", "--locked"],
  ];
  for (const args of cargoCommands) execFileSync("cargo", args, { stdio: "inherit" });
}
