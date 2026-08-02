import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repositoryRoot, "src-tauri", "resources", "toolchains");

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
  join(outputRoot, "package.json"),
  '{"name":"aurona-code-builtin-toolchains","private":true,"type":"module","version":"0.3.4"}\n',
);
await writeFile(join(outputRoot, "pyright", "package.json"), '{"type":"commonjs"}\n');

const runtimeName = process.platform === "win32" ? "node.exe" : "node";
await cp(process.execPath, join(outputRoot, "runtime", runtimeName));

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

console.log(`Prepared built-in toolchains at ${outputRoot}`);
