import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guestDir = join(root, "Extensions", "auronalabs.planner");
const wasmPath = join(guestDir, "target", "wasm32-wasip2", "release", "aurona_planner.wasm");
const outputDir = join(root, "MarketplacePackages");
const outputPath = join(outputDir, "auronalabs.planner.aurx");

function findVcvars64() {
  const candidates = [
    "D:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Auxiliary\\Build\\vcvars64.bat",
  ];
  return candidates.find((p) => existsSync(p));
}

function buildGuest() {
  const manifestPath = join(guestDir, "Cargo.toml");
  const lockPath = join(guestDir, "Cargo.lock");
  const args = ["build", "--manifest-path", manifestPath, "--target", "wasm32-wasip2", "--release"];
  if (existsSync(lockPath)) args.push("--locked");

  const remapFlags = [
    `--remap-path-prefix=${guestDir}=/auronalabs-planner`,
    `--remap-path-prefix=${root}=/aurona`,
  ];
  const env = {
    ...process.env,
    CARGO_ENCODED_RUSTFLAGS: [process.env.CARGO_ENCODED_RUSTFLAGS || "", ...remapFlags]
      .filter(Boolean)
      .join("\x1f"),
  };

  try {
    execFileSync("cargo", args, { stdio: "inherit", env });
  } catch (firstError) {
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

function zipStore(entries) {
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

function main() {
  buildGuest();

  const wasm = readFileSync(wasmPath);
  if (wasm.length < 4 || wasm.subarray(0, 4).toString("binary") !== "\0asm") {
    throw new Error(`无效的 WASM 产物: ${wasmPath}`);
  }
  const view = readFileSync(join(guestDir, "ui", "index.html"), "utf8");
  if (!view.includes("Content-Security-Policy")) {
    throw new Error("插件 UI 缺少 CSP meta");
  }
  if (!view.includes("<!--AURONA_RENDER_SLOT-->")) {
    throw new Error("插件 UI 缺少渲染槽位 <!--AURONA_RENDER_SLOT-->");
  }
  const icon = readFileSync(join(guestDir, "assets", "icon.svg"), "utf8");

  const manifest = {
    packageVersion: 1,
    id: "auronalabs.planner",
    name: "任务面板",
    displayName: { "zh-CN": "任务面板", "zh-Hant": "任務面板", en: "Task Panel" },
    displayName: {
      "zh-CN": "任务计划",
      "zh-Hant": "任務計劃",
      en: "Task Planner",
    },
    description: "Visual task planner and test case checklist for Aurona Code",
    displayDescription: {
      "zh-CN": "可视化任务计划与测试用例清单看板",
      "zh-Hant": "視覺化任務計劃與測試用例清單看板",
      en: "Visual task planner and test case checklist for Aurona Code",
    },
    publisher: "auronalabs",
    version: "0.1.0",
    engine: { auronaCode: ">=0.3.12" },
    permissions: ["workspace.read", "workspace.readwrite", "clipboard.write"],
    changelog: "首个公开版本：提供任务清单持久化、任务状态管理和剪贴板交互。",
    runtime: { component: "extension.wasm" },
    sidebar: {
      title: "Planner",
      displayTitle: {
        "zh-CN": "计划看板",
        "zh-Hant": "計劃看板",
        en: "Planner",
      },
      icon: "assets/icon.svg",
    },
    view: { entry: "ui/index.html" },
    marketplace: {
      categories: ["Productivity", "Project Management"],
      tags: ["planner", "kanban", "tasks", "todo", "productivity"],
      author: "Aurona Code Team",
      homepage: "https://github.com/AuronaLabs/AuronaCode-Early",
      repository: "https://github.com/AuronaLabs/AuronaCode-Early",
      license: "MIT",
    },
  };
  manifest.displayName = { "zh-CN": "任务面板", "zh-Hant": "任務面板", en: "Task Panel" };
  manifest.displayDescription = {
    "zh-CN": "可视化任务规划和测试用例清单",
    "zh-Hant": "可視化任務規劃與測試案例清單",
    en: "Visual task planner and test case checklist for Aurona Code",
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const normalizedView = view.replace(/\r\n/g, "\n");
  const normalizedIcon = icon.replace(/\r\n/g, "\n");

  const aurx = zipStore([
    ["manifest.json", manifestBytes],
    ["extension.wasm", wasm],
    ["ui/index.html", Buffer.from(normalizedView, "utf8")],
    ["assets/icon.svg", Buffer.from(normalizedIcon, "utf8")],
  ]);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, aurx);

  const kilobytes = (aurx.length / 1024).toFixed(1);
  console.log(`auronalabs.planner.aurx 构建完成: ${aurx.length} bytes (${kilobytes} KiB)`);
  console.log(`输出: ${outputPath}`);
}

main();
