import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

function findVcvars64() {
  const candidates = [
    "D:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Auxiliary\\Build\\vcvars64.bat",
  ];
  return candidates.find((p) => existsSync(p));
}

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
