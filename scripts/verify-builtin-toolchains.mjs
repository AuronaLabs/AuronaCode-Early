import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolchainsRoot = join(repositoryRoot, "src-tauri", "resources", "toolchains");
const contractOnly = process.argv.includes("--contract");
const execFile = promisify(execFileCallback);
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE ?? "";
const isMacUniversal = targetTriple === "universal-apple-darwin";

async function requireFile(relativePath, { nonEmpty = true } = {}) {
  const path = join(toolchainsRoot, relativePath);
  await access(path, constants.R_OK);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Expected a file: ${path}`);
  if (nonEmpty && metadata.size === 0) throw new Error(`Expected a non-empty file: ${path}`);
}

await requireFile(".gitkeep");

if (contractOnly) {
  console.log(`Built-in toolchain resource contract is present at ${toolchainsRoot}`);
  process.exit(0);
}

const packageMetadata = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8"),
);
const manifest = JSON.parse(await readFile(join(toolchainsRoot, "manifest.json"), "utf8"));
const runtimeName = process.platform === "win32" ? "node.exe" : "node";
const runtimePath = join(toolchainsRoot, "runtime", runtimeName);

if (manifest.schemaVersion !== 1) {
  throw new Error(`Unsupported built-in toolchain manifest schema: ${manifest.schemaVersion}`);
}
if (manifest.applicationVersion !== packageMetadata.version) {
  throw new Error(
    `Toolchain version ${manifest.applicationVersion} does not match application ${packageMetadata.version}`,
  );
}
const expectedArchitecture = isMacUniversal ? "universal" : process.arch;
if (manifest.platform !== process.platform || manifest.architecture !== expectedArchitecture) {
  throw new Error(
    `Toolchains target ${manifest.platform}/${manifest.architecture}, expected ${process.platform}/${expectedArchitecture}`,
  );
}
if (manifest.runtime !== runtimeName) {
  throw new Error(`Toolchain runtime ${manifest.runtime} does not match expected ${runtimeName}`);
}

await Promise.all([
  requireFile(join("runtime", runtimeName)),
  requireFile(join("pyright", "langserver.index.cjs")),
  requireFile(join("pyright", "dist", "pyright-langserver.js")),
  requireFile(join("pyright", "LICENSE.txt")),
  requireFile(join("typescript-language-server", "cli.mjs")),
  requireFile(join("typescript-language-server", "LICENSE")),
]);

if (isMacUniversal) {
  if (
    !Array.isArray(manifest.runtimeArchitectures) ||
    !["arm64", "x64"].every((architecture) => manifest.runtimeArchitectures.includes(architecture))
  ) {
    throw new Error("Universal macOS runtime manifest must declare arm64 and x64");
  }
  await execFile("lipo", [
    runtimePath,
    "-verify_arch",
    "arm64",
    "x86_64",
  ]);
}

const { stdout: runtimeVersionOutput } = await execFile(runtimePath, ["--version"]);
if (runtimeVersionOutput.trim() !== `v${manifest.runtimeVersion}`) {
  throw new Error(
    `Bundled runtime reported ${runtimeVersionOutput.trim()}, expected v${manifest.runtimeVersion}`,
  );
}

console.log(
  `Built-in toolchains verified for ${manifest.platform}/${manifest.architecture} (${manifest.applicationVersion})`,
);
