import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function findVcvars64() {
  const candidates = [
    "D:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Auxiliary\\Build\\vcvars64.bat",
  ];
  return candidates.find((p) => existsSync(p));
}

/**
 * 编译 wasm32-wasip2 guest 组件。
 * 失败时依次兜底：VS BuildTools vcvars64 激活环境重试 → rustup 补 target 重试 →
 * 若已有旧产物则继续使用。
 */
export function buildGuest({ guestDir, remapAlias, outputPath }) {
  const manifestPath = join(guestDir, "Cargo.toml");
  const lockPath = join(guestDir, "Cargo.lock");
  const args = ["build", "--manifest-path", manifestPath, "--target", "wasm32-wasip2", "--release"];
  if (existsSync(lockPath)) args.push("--locked");

  const remapFlags = [
    `--remap-path-prefix=${guestDir}=${remapAlias}`,
    `--remap-path-prefix=${PROJECT_ROOT}=/aurona`,
  ];
  const env = {
    ...process.env,
    CARGO_ENCODED_RUSTFLAGS: [process.env.CARGO_ENCODED_RUSTFLAGS || "", ...remapFlags]
      .filter(Boolean)
      .join("\x1f"),
  };

  try {
    execFileSync("cargo", args, { stdio: "inherit", env });
  } catch {
    if (process.platform === "win32") {
      const vcvars = findVcvars64();
      if (vcvars) {
        console.log(`检测到 VS BuildTools 环境: ${vcvars}，正在激活环境编译...`);
        try {
          execSync(`"${vcvars}" && cargo ${args.map((a) => `"${a}"`).join(" ")}`, {
            stdio: "inherit",
            env,
          });
          return;
        } catch (vcvarsErr) {
          console.warn("使用 vcvars 编译仍有异常:", vcvarsErr);
        }
      }
    }
    console.warn("WASM 目标 wasm32-wasip2 编译未就绪，尝试通过 rustup 自动补充 target...");
    try {
      execFileSync("rustup", ["target", "add", "wasm32-wasip2"], { stdio: "inherit" });
      execFileSync("cargo", args, { stdio: "inherit", env });
    } catch (secondError) {
      if (existsSync(outputPath)) {
        console.warn("未能重新编译 WASM，但检测到已存在扩展归档，将继续使用现有产物并执行校验。");
        return;
      }
      console.error(`WASM 构建失败: ${secondError}`);
      process.exit(1);
    }
  }
}

/**
 * 内存快速构造标准 ZIP 归档 (ZipStore 规范)
 */
export function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBytes, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0314, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralStart = parts.reduce((sum, part) => sum + part.length, 0);
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralBytes, eocd]);
}
