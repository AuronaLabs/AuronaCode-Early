import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { cp, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repositoryRoot, "src-tauri", "resources", "toolchains");
const packageMetadata = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const execFile = promisify(execFileCallback);
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE ?? "";
const isMacUniversal = targetTriple === "universal-apple-darwin";
const builtinNodeVersion = "22.22.0";
const builtinMacNodeSha256 = {
  arm64: "5ed4db0fcf1eaf84d91ad12462631d73bf4576c1377e192d222e48026a902640",
  x64: "5ea50c9d6dea3dfa3abb66b2656f7a4e1c8cef23432b558d45fb538c7b5dedce",
};

if (!outputRoot.startsWith(join(repositoryRoot, "src-tauri", "resources"))) {
  throw new Error(`Refusing to prepare toolchains outside src-tauri/resources: ${outputRoot}`);
}

await rm(outputRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(join(outputRoot, "runtime"), { recursive: true }),
  mkdir(join(outputRoot, "pyright"), { recursive: true }),
  mkdir(join(outputRoot, "typescript-language-server"), { recursive: true }),
]);
await writeFile(
  join(outputRoot, ".gitkeep"),
  "Generated toolchains are intentionally excluded from Git. Keep this file so direct Cargo checks can validate the Tauri resource directory.\n",
);
await writeFile(
  join(outputRoot, "package.json"),
  `${JSON.stringify({
    name: "aurona-code-builtin-toolchains",
    private: true,
    type: "module",
    version: packageMetadata.version,
  })}\n`,
);
await writeFile(join(outputRoot, "pyright", "package.json"), '{"type":"commonjs"}\n');

const runtimeName = process.platform === "win32" ? "node.exe" : "node";
const runtimePath = join(outputRoot, "runtime", runtimeName);
let runtimeArchitecture = process.arch;
let runtimeArchitectures = [process.arch];
if (isMacUniversal) {
  if (process.platform !== "darwin") {
    throw new Error("The universal macOS runtime can only be prepared on macOS");
  }
  await prepareUniversalMacNode(runtimePath, builtinNodeVersion);
  runtimeArchitecture = "universal";
  runtimeArchitectures = ["arm64", "x64"];
} else {
  await cp(process.execPath, runtimePath);
}

const pyrightRoot = join(repositoryRoot, "node_modules", "pyright");
await Promise.all([
  cp(join(pyrightRoot, "langserver.index.js"), join(outputRoot, "pyright", "langserver.index.cjs")),
  cp(join(pyrightRoot, "dist"), join(outputRoot, "pyright", "dist"), { recursive: true }),
  cp(join(pyrightRoot, "LICENSE.txt"), join(outputRoot, "pyright", "LICENSE.txt")),
]);

await build({
  entryPoints: [
    join(repositoryRoot, "node_modules", "typescript-language-server", "lib", "cli.mjs"),
  ],
  outfile: join(outputRoot, "typescript-language-server", "cli.mjs"),
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
await cp(
  join(repositoryRoot, "node_modules", "typescript-language-server", "LICENSE"),
  join(outputRoot, "typescript-language-server", "LICENSE"),
);

await writeFile(
  join(outputRoot, "manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      applicationVersion: packageMetadata.version,
      platform: process.platform,
      architecture: runtimeArchitecture,
      runtimeArchitectures,
      runtime: runtimeName,
      runtimeVersion: isMacUniversal ? builtinNodeVersion : process.versions.node,
      languageServers: ["pyright", "typescript-language-server"],
    },
    null,
    2,
  )}\n`,
);

console.log(`Prepared built-in toolchains at ${outputRoot}`);

async function prepareUniversalMacNode(destination, version) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "aurona-node-universal-"));
  try {
    const baseUrl = `https://nodejs.org/dist/v${version}`;
    const binaries = [];
    for (const architecture of ["arm64", "x64"]) {
      const archiveName = `node-v${version}-darwin-${architecture}.tar.gz`;
      const expected = builtinMacNodeSha256[architecture];
      const archivePath = join(temporaryRoot, archiveName);
      const archive = await downloadBytes(`${baseUrl}/${archiveName}`);
      const actual = createHash("sha256").update(archive).digest("hex");
      if (actual !== expected) {
        throw new Error(`Checksum mismatch for ${archiveName}: ${actual} != ${expected}`);
      }
      await writeFile(archivePath, archive);
      await execFile("tar", ["-xzf", archivePath, "-C", temporaryRoot]);
      binaries.push(join(temporaryRoot, `node-v${version}-darwin-${architecture}`, "bin", "node"));
    }
    await execFile("lipo", ["-create", ...binaries, "-output", destination]);
    await chmod(destination, 0o755);
    await execFile("lipo", [destination, "-verify_arch", "arm64", "x86_64"]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function downloadBytes(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
