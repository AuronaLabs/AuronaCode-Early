import { execSync } from "node:child_process";
import { findVcvars64 } from "./lib/extension-build-common.mjs";

function runRustTests() {
  const args = process.argv.slice(2);
  const cargoCmd = `cargo test --manifest-path src-tauri/Cargo.toml ${args.join(" ")}`;

  if (process.platform === "win32") {
    const vcvars = findVcvars64();
    if (vcvars) {
      console.log(`[test:rust] 载入 VS BuildTools 环境: ${vcvars}`);
      execSync(`"${vcvars}" && ${cargoCmd}`, { stdio: "inherit" });
      return;
    }
  }

  execSync(cargoCmd, { stdio: "inherit" });
}

runRustTests();
