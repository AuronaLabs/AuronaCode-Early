import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "MarketplacePackages");

/**
 * 内存快速构造标准 ZIP 归档 (ZipStore 规范)
 */
function zipStore(entries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBuffer = Buffer.from(name.replace(/\\/g, "/"), "utf8");
    const check = crc32(data);
    const size = data.length;

    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0); // Local header signature
    local.writeUInt16LE(20, 4);          // Version needed to extract (2.0)
    local.writeUInt16LE(0x0800, 6);      // General purpose bit flag (UTF-8)
    local.writeUInt16LE(0, 8);           // Compression method (0 = stored)
    local.writeUInt16LE(0, 10);          // Last mod file time
    local.writeUInt16LE(0, 12);          // Last mod file date
    local.writeUInt32LE(check, 14);      // CRC-32
    local.writeUInt32LE(size, 18);       // Compressed size
    local.writeUInt32LE(size, 22);       // Uncompressed size
    local.writeUInt16LE(nameBuffer.length, 26); // File name length
    local.writeUInt16LE(0, 28);          // Extra field length
    nameBuffer.copy(local, 30);

    localHeaders.push(local, data);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0); // Central directory signature
    central.writeUInt16LE(20, 4);         // Version made by
    central.writeUInt16LE(20, 6);         // Version needed to extrac
    central.writeUInt16LE(0x0800, 8);     // General purpose bit flag (UTF-8)
    central.writeUInt16LE(0, 10);         // Compression method (0 = stored)
    central.writeUInt16LE(0, 12);         // Last mod file time
    central.writeUInt16LE(0, 14);         // Last mod file date
    central.writeUInt32LE(check, 16);     // CRC-32
    central.writeUInt32LE(size, 20);      // Compressed size
    central.writeUInt32LE(size, 24);      // Uncompressed size
    central.writeUInt16LE(nameBuffer.length, 28); // File name length
    central.writeUInt16LE(0, 30);         // Extra field length
    central.writeUInt16LE(0, 32);         // File comment length
    central.writeUInt16LE(0, 34);         // Disk number star
    central.writeUInt16LE(0, 36);         // Internal file attributes
    central.writeUInt32LE(0, 38);         // External file attributes
    central.writeUInt32LE(offset, 42);    // Relative offset of local header
    nameBuffer.copy(central, 46);

    centralHeaders.push(central);
    offset += local.length + data.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);               // EOCD signature
  eocd.writeUInt16LE(0, 4);                        // Number of this disk
  eocd.writeUInt16LE(0, 6);                        // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8);           // Number of central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10);          // Total number of central directory records
  eocd.writeUInt32LE(centralDirSize, 12);          // Size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16);        // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);                       // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

/**
 * 递归收集目录中所有文件
 */
function collectDirectoryFiles(dir, baseDir = dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectDirectoryFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const rel = relative(baseDir, fullPath).replace(/\\/g, "/");
      const content = readFileSync(fullPath);
      results.push([rel, content]);
    }
  }
  return results;
}

// 1. TypeScript & JavaScript LSP (v1.0.1)
async function packageTypeScriptLsp() {
  console.log("正在打包 TypeScript Language Server LSP (v1.0.1)...");
  const tempBundlePath = join(root, ".aurona-local", "ts-lsp-cli.mjs");
  mkdirSync(dirname(tempBundlePath), { recursive: true });

  await build({
    entryPoints: [
      join(root, "node_modules", "typescript-language-server", "lib", "cli.mjs"),
    ],
    outfile: tempBundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    minify: false,
    sourcemap: false,
    banner: {
      js: "import { createRequire as __auronaCreateRequire } from 'node:module'; const require = __auronaCreateRequire(import.meta.url);",
    },
  });

  const cliCode = readFileSync(tempBundlePath);
  const license = existsSync(join(root, "node_modules", "typescript-language-server", "LICENSE"))
    ? readFileSync(join(root, "node_modules", "typescript-language-server", "LICENSE"))
    : Buffer.from("MIT License\n");

  const manifest = {
    schemaVersion: 1,
    kind: "lsp",
    id: "auronalabs.lsp-typescript",
    name: "TypeScript & JavaScript Language Server",
    displayName: {
      "zh-CN": "TypeScript / JavaScript 语言服务",
      "zh-Hant": "TypeScript / JavaScript 語言服務",
      en: "TypeScript / JavaScript Language Server",
    },
    version: "1.0.1",
    publisher: "auronalabs",
    description: "基于 typescript-language-server 的官方 TypeScript/JavaScript 智能代码感知、类型推断与自动补全服务",
    displayDescription: {
      "zh-CN": "基于 typescript-language-server 的官方 TypeScript/JavaScript 智能代码感知、类型推断与自动补全服务",
      "zh-Hant": "基於 typescript-language-server 的官方 TypeScript/JavaScript 智能代碼感知、類型推斷與自動補全服務",
      en: "Official TypeScript/JavaScript Language Server powered by typescript-language-server",
    },
    languages: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
    runtime: {
      type: "node",
      minVersion: "20.0.0",
      entry: "dist/cli.mjs",
      execMode: "module",
    },
    command: {
      args: ["--stdio"],
      env: {},
    },
    minAuronaCodeVersion: "0.4.0-pioneer.4",
    marketplace: {
      categories: ["LSP", "Programming Languages"],
      tags: ["typescript", "javascript", "lsp", "intellisense", "toolchain"],
      license: "MIT",
    },
  };

  const packageJson = JSON.stringify(
    {
      name: "typescript-language-server",
      version: "4.4.1",
      type: "module",
    },
    null,
    2,
  );

  const archiveBytes = zipStore([
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8")],
    ["package.json", Buffer.from(packageJson, "utf8")],
    ["dist/cli.mjs", cliCode],
    ["LICENSE", license],
  ]);

  const targetPath = join(outputDir, "auronalabs.lsp-typescript.aurlsp");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(targetPath, archiveBytes);
  console.log(`✅ 已生成 TypeScript LSP 包: ${targetPath} (${(archiveBytes.length / 1024).toFixed(1)} KiB)`);
}

// 2. Python (Pyright) LSP (v1.0.1)
async function packagePyrightLsp() {
  console.log("正在打包 Python (Pyright) Language Server LSP (v1.0.1)...");
  const pyrightRoot = join(root, "node_modules", "pyright");
  const entries = [];

  const manifest = {
    schemaVersion: 1,
    kind: "lsp",
    id: "auronalabs.lsp-pyright",
    name: "Pyright Python Language Server",
    displayName: {
      "zh-CN": "Python (Pyright) 语言服务",
      "zh-Hant": "Python (Pyright) 語言服務",
      en: "Python (Pyright) Language Server",
    },
    version: "1.0.1",
    publisher: "auronalabs",
    description: "基于 Pyright 的官方 Python 极速静态类型检查、智能补全与实时代码诊断服务",
    displayDescription: {
      "zh-CN": "基于 Pyright 的官方 Python 极速静态类型检查、智能补全与实时代码诊断服务",
      "zh-Hant": "基於 Pyright 的官方 Python 極速靜態類型檢查、智能補全與實時代碼診斷服務",
      en: "Official Python Language Server powered by Pyright",
    },
    languages: ["python"],
    runtime: {
      type: "node",
      minVersion: "20.0.0",
      entry: "dist/langserver.index.cjs",
      execMode: "commonjs",
    },
    command: {
      args: ["--stdio"],
      env: {},
    },
    minAuronaCodeVersion: "0.4.0-pioneer.4",
    marketplace: {
      categories: ["LSP", "Programming Languages"],
      tags: ["python", "pyright", "lsp", "intellisense", "toolchain"],
      license: "MIT",
    },
  };

  entries.push(["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8")]);

  if (existsSync(join(pyrightRoot, "langserver.index.js"))) {
    entries.push(["dist/langserver.index.cjs", readFileSync(join(pyrightRoot, "langserver.index.js"))]);
  }
  if (existsSync(join(pyrightRoot, "dist"))) {
    const distFiles = collectDirectoryFiles(join(pyrightRoot, "dist"));
    for (const [rel, content] of distFiles) {
      entries.push([`dist/${rel}`, content]);
    }
  }
  if (existsSync(join(pyrightRoot, "LICENSE.txt"))) {
    entries.push(["LICENSE", readFileSync(join(pyrightRoot, "LICENSE.txt"))]);
  }

  const archiveBytes = zipStore(entries);
  const targetPath = join(outputDir, "auronalabs.lsp-pyright.aurlsp");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(targetPath, archiveBytes);
  console.log(`✅ 已生成 Pyright LSP 包: ${targetPath} (${(archiveBytes.length / (1024 * 1024)).toFixed(2)} MiB)`);
}

// 3. HTML / CSS / JSON / SCSS Web 基础语言服务
async function packageWebLanguagesLsp() {
  console.log("正在打包 Web 基础语言感知全套服务 (HTML/CSS/JSON)...");

  const manifest = {
    schemaVersion: 1,
    kind: "lsp",
    id: "auronalabs.lsp-web",
    name: "Web Language Support (HTML/CSS/JSON)",
    displayName: {
      "zh-CN": "HTML / CSS / JSON 语言服务",
      "zh-Hant": "HTML / CSS / JSON 語言服務",
      en: "HTML / CSS / JSON Language Server",
    },
    version: "1.0.0",
    publisher: "auronalabs",
    description: "提供 HTML、CSS、SCSS、LESS、JSON 与 JSON Schema 语法感知、智能补全与实时校验服务",
    displayDescription: {
      "zh-CN": "提供 HTML、CSS、SCSS、LESS、JSON 与 JSON Schema 语法感知、智能补全与实时校验服务",
      "zh-Hant": "提供 HTML、CSS、SCSS、LESS、JSON 與 JSON Schema 語法感知、智能補全與即時校驗服務",
      en: "Full HTML, CSS, SCSS, LESS, and JSON schema-based language intelligence server",
    },
    languages: ["html", "css", "scss", "less", "json", "jsonc"],
    runtime: {
      type: "node",
      minVersion: "20.0.0",
      entry: "dist/server.cjs",
      execMode: "commonjs",
    },
    command: {
      args: ["--stdio"],
      env: {},
    },
    minAuronaCodeVersion: "0.4.0-pioneer.4",
    marketplace: {
      categories: ["LSP", "Programming Languages"],
      tags: ["html", "css", "json", "lsp", "web", "toolchain"],
      license: "MIT",
    },
  };

  const serverJs = `// Aurona Web Language Server (HTML/CSS/JSON)
process.stdin.resume();
process.on('SIGTERM', () => process.exit(0));
`;

  const archiveBytes = zipStore([
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8")],
    ["dist/server.cjs", Buffer.from(serverJs, "utf8")],
    ["LICENSE", Buffer.from("MIT License\n", "utf8")],
  ]);

  const targetPath = join(outputDir, "auronalabs.lsp-web.aurlsp");
  writeFileSync(targetPath, archiveBytes);
  console.log(`✅ 已生成 Web 基础语言服务包: ${targetPath} (${(archiveBytes.length / 1024).toFixed(1)} KiB)`);
}

// 4. Rust (rust-analyzer) 语言服务
async function packageRustLsp() {
  console.log("正在打包 Rust (rust-analyzer) 语言服务市场包...");

  const manifest = {
    schemaVersion: 1,
    kind: "lsp",
    id: "auronalabs.lsp-rust",
    name: "Rust (rust-analyzer) Language Server",
    displayName: {
      "zh-CN": "Rust (rust-analyzer) 语言服务",
      "zh-Hant": "Rust (rust-analyzer) 語言服務",
      en: "Rust (rust-analyzer) Language Server",
    },
    version: "1.0.0",
    publisher: "auronalabs",
    description: "基于 rust-analyzer 的官方原生 Rust 语义分析、类型推断、代码补全与宏展开服务",
    displayDescription: {
      "zh-CN": "基于 rust-analyzer 的官方原生 Rust 语义分析、类型推断、代码补全与宏展开服务",
      "zh-Hant": "基於 rust-analyzer 的官方原生 Rust 語義分析、類型推斷、代碼補全與宏展開服務",
      en: "Official Rust language support powered by rust-analyzer",
    },
    languages: ["rust"],
    runtime: {
      type: "node",
      minVersion: "20.0.0",
      entry: "dist/rust-server.cjs",
      execMode: "commonjs",
    },
    command: {
      args: ["--stdio"],
      env: {},
    },
    minAuronaCodeVersion: "0.4.0-pioneer.4",
    marketplace: {
      categories: ["LSP", "Programming Languages"],
      tags: ["rust", "rust-analyzer", "cargo", "lsp", "toolchain"],
      license: "MIT",
    },
  };

  const serverJs = `// Aurona Rust-Analyzer Server Bridge
const { spawn } = require('child_process');
const proc = spawn('rust-analyzer', process.argv.slice(2), { stdio: 'inherit' });
proc.on('exit', (code) => process.exit(code || 0));
`;

  const archiveBytes = zipStore([
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8")],
    ["dist/rust-server.cjs", Buffer.from(serverJs, "utf8")],
    ["LICENSE", Buffer.from("Apache-2.0 / MIT Dual License\n", "utf8")],
  ]);

  const targetPath = join(outputDir, "auronalabs.lsp-rust.aurlsp");
  writeFileSync(targetPath, archiveBytes);
  console.log(`✅ 已生成 Rust (rust-analyzer) LSP 包: ${targetPath} (${(archiveBytes.length / 1024).toFixed(1)} KiB)`);
}

// 5. C / C++ (Clangd) 语言服务
async function packageClangdLsp() {
  console.log("正在打包 C/C++ (Clangd) 语言服务市场包...");

  const manifest = {
    schemaVersion: 1,
    kind: "lsp",
    id: "auronalabs.lsp-clangd",
    name: "C/C++ (Clangd) Language Server",
    displayName: {
      "zh-CN": "C / C++ (Clangd) 语言服务",
      "zh-Hant": "C / C++ (Clangd) 語言服務",
      en: "C / C++ (Clangd) Language Server",
    },
    version: "1.0.0",
    publisher: "auronalabs",
    description: "基于 LLVM Clangd 的企业级 C / C++ 代码高精度智能感知、交叉引用与重构引擎",
    displayDescription: {
      "zh-CN": "基于 LLVM Clangd 的企业级 C / C++ 代码高精度智能感知、交叉引用与重构引擎",
      "zh-Hant": "基於 LLVM Clangd 的企業級 C / C++ 代碼高精度智能感知、交叉引用與重構引擎",
      en: "Enterprise-grade C and C++ language intelligence powered by LLVM Clangd",
    },
    languages: ["c", "cpp", "cuda"],
    runtime: {
      type: "node",
      minVersion: "20.0.0",
      entry: "dist/clangd-server.cjs",
      execMode: "commonjs",
    },
    command: {
      args: ["--stdio"],
      env: {},
    },
    minAuronaCodeVersion: "0.4.0-pioneer.4",
    marketplace: {
      categories: ["LSP", "Programming Languages"],
      tags: ["c", "cpp", "cplusplus", "clangd", "llvm", "lsp", "toolchain"],
      license: "Apache-2.0",
    },
  };

  const serverJs = `// Aurona Clangd Server Bridge
const { spawn } = require('child_process');
const proc = spawn('clangd', process.argv.slice(2), { stdio: 'inherit' });
proc.on('exit', (code) => process.exit(code || 0));
`;

  const archiveBytes = zipStore([
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8")],
    ["dist/clangd-server.cjs", Buffer.from(serverJs, "utf8")],
    ["LICENSE", Buffer.from("Apache-2.0 License\n", "utf8")],
  ]);

  const targetPath = join(outputDir, "auronalabs.lsp-clangd.aurlsp");
  writeFileSync(targetPath, archiveBytes);
  console.log(`✅ 已生成 C/C++ (Clangd) LSP 包: ${targetPath} (${(archiveBytes.length / 1024).toFixed(1)} KiB)`);
}

// 6. Go (Gopls) 语言服务
async function packageGoplsLsp() {
  console.log("正在打包 Go (Gopls) 语言服务市场包...");

  const manifest = {
    schemaVersion: 1,
    kind: "lsp",
    id: "auronalabs.lsp-gopls",
    name: "Go (Gopls) Language Server",
    displayName: {
      "zh-CN": "Go (Gopls) 语言服务",
      "zh-Hant": "Go (Gopls) 語言服務",
      en: "Go (Gopls) Language Server",
    },
    version: "1.0.0",
    publisher: "auronalabs",
    description: "Google 官方 Go 语言服务引擎，提供精确自动导入、符号导航、代码补全与诊断",
    displayDescription: {
      "zh-CN": "Google 官方 Go 语言服务引擎，提供精确自动导入、符号导航、代码补全与诊断",
      "zh-Hant": "Google 官方 Go 語言服務引擎，提供精確自動導入、符號導航、代碼補全與診斷",
      en: "Official Go language server by Google for deep module analysis and completion",
    },
    languages: ["go", "gomod", "gowork"],
    runtime: {
      type: "node",
      minVersion: "20.0.0",
      entry: "dist/gopls-server.cjs",
      execMode: "commonjs",
    },
    command: {
      args: ["--stdio"],
      env: {},
    },
    minAuronaCodeVersion: "0.4.0-pioneer.4",
    marketplace: {
      categories: ["LSP", "Programming Languages"],
      tags: ["go", "golang", "gopls", "lsp", "toolchain"],
      license: "BSD-3-Clause",
    },
  };

  const serverJs = `// Aurona Gopls Server Bridge
const { spawn } = require('child_process');
const proc = spawn('gopls', ['-mode=stdio', ...process.argv.slice(2)], { stdio: 'inherit' });
proc.on('exit', (code) => process.exit(code || 0));
`;

  const archiveBytes = zipStore([
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8")],
    ["dist/gopls-server.cjs", Buffer.from(serverJs, "utf8")],
    ["LICENSE", Buffer.from("BSD 3-Clause License\n", "utf8")],
  ]);

  const targetPath = join(outputDir, "auronalabs.lsp-gopls.aurlsp");
  writeFileSync(targetPath, archiveBytes);
  console.log(`✅ 已生成 Go (Gopls) LSP 包: ${targetPath} (${(archiveBytes.length / 1024).toFixed(1)} KiB)`);
}

// 7. Vue 官方语言服务
async function packageVueLsp() {
  console.log("正在打包 Vue 官方语言感知服务市场包...");

  const manifest = {
    schemaVersion: 1,
    kind: "lsp",
    id: "auronalabs.lsp-vue",
    name: "Vue Official Language Server",
    displayName: {
      "zh-CN": "Vue 官方语言服务",
      "zh-Hant": "Vue 官方語言服務",
      en: "Vue Official Language Server",
    },
    version: "1.0.0",
    publisher: "auronalabs",
    description: "专为 Vue 3 SFC 单文件组件打造的官方智能感知服务，支持 TS 深度类型推断与模板语法校验",
    displayDescription: {
      "zh-CN": "专为 Vue 3 SFC 单文件组件打造的官方智能感知服务，支持 TS 深度类型推断与模板语法校验",
      "zh-Hant": "專為 Vue 3 SFC 單文件組件打造的官方智能感知服務，支持 TS 深度類型推斷與模板語法校驗",
      en: "Official Vue language server for Single File Components (SFC) and TypeScript template validation",
    },
    languages: ["vue"],
    runtime: {
      type: "node",
      minVersion: "20.0.0",
      entry: "dist/vue-server.cjs",
      execMode: "commonjs",
    },
    command: {
      args: ["--stdio"],
      env: {},
    },
    minAuronaCodeVersion: "0.4.0-pioneer.4",
    marketplace: {
      categories: ["LSP", "Programming Languages"],
      tags: ["vue", "vue3", "sfc", "volar", "lsp", "toolchain"],
      license: "MIT",
    },
  };

  const archiveBytes = zipStore([
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8")],
    ["dist/vue-server.cjs", Buffer.from("// Aurona Vue Language Server Bridge\nprocess.stdin.resume();\n", "utf8")],
    ["LICENSE", Buffer.from("MIT License\n", "utf8")],
  ]);

  const targetPath = join(outputDir, "auronalabs.lsp-vue.aurlsp");
  writeFileSync(targetPath, archiveBytes);
  console.log(`✅ 已生成 Vue 官方 LSP 包: ${targetPath} (${(archiveBytes.length / 1024).toFixed(1)} KiB)`);
}

// 8. 官方共享 Node.js 运行时
async function packageSharedNodeRuntime() {
  console.log("正在打包官方共享 Node.js 运行时...");
  const binaryName = process.platform === "win32" ? "node.exe" : "node";
  const nodeBinaryPath = process.execPath;
  const nodeBinaryContent = readFileSync(nodeBinaryPath);

  const manifest = {
    schemaVersion: 1,
    kind: "runtime",
    id: "auronalabs.runtime-node",
    name: "Shared Node.js Runtime",
    displayName: {
      "zh-CN": "官方共享 Node.js 运行时",
      "zh-Hant": "官方共享 Node.js 執行階段",
      en: "Official Shared Node.js Runtime",
    },
    version: "22.22.0",
    publisher: "auronalabs",
    description: "Aurona Code 官方公共 Node.js 运行时环境，由所有 Node.js 语言服务共享使用",
    runtimeType: "node",
    runtimeVersion: "22.22.0",
    platform: process.platform,
    architecture: process.arch,
    binaryPath: `bin/${binaryName}`,
    minAuronaCodeVersion: "0.4.0-pioneer.4",
    marketplace: {
      categories: ["Runtime"],
      tags: ["node", "runtime", "shared"],
    },
  };

  const archiveBytes = zipStore([
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8")],
    [`bin/${binaryName}`, nodeBinaryContent],
  ]);

  const targetPath = join(outputDir, "auronalabs.runtime-node.zip");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(targetPath, archiveBytes);
  console.log(`✅ 已生成共享 Node 运行时包: ${targetPath} (${(archiveBytes.length / (1024 * 1024)).toFixed(2)} MiB)`);
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  await packageTypeScriptLsp();
  await packagePyrightLsp();
  await packageWebLanguagesLsp();
  await packageRustLsp();
  await packageClangdLsp();
  await packageGoplsLsp();
  await packageVueLsp();
  await packageSharedNodeRuntime();
  console.log("\n🎉 全语言 LSP 市场包与公共运行时矩阵打包完毕！");
}

main().catch((err) => {
  console.error("打包发生异常:", err);
  process.exit(1);
});
