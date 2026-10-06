import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sourceProvenance(root) {
  const paths = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root })
    .toString("utf8").split("\0").filter(Boolean);
  const files = [...new Set(paths)].filter((file) =>
    /^(Src\/|Extensions\/|public\/|src-tauri\/(src\/|resources\/|capabilities\/|build\.rs$|Cargo\.(toml|lock)$|.*\.conf\.json$)|scripts\/|package\.json$|pnpm-lock\.yaml$|\.gitignore$|vite\.config\.ts$|index\.html$|splash\.html$)/.test(file)
    && !["scripts/desktop-audit.mjs", "scripts/prepare-directory-stress.mjs"].includes(file)
    && fs.existsSync(path.join(root, file))).sort();
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file); digest.update("\0");
    digest.update(createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest());
  }
  return { sourceSha256: digest.digest("hex"), sourceFileCount: files.length,
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim() };
}

export function artifactSha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
