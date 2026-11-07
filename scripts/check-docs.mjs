import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDocuments } from "./lib/markdown-documents.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [...new Set(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: root, encoding: "utf8",
}).split("\0"))].filter((file) => /\.md$/i.test(file) && fs.existsSync(path.join(root, file))).sort();
const result = validateDocuments(root, files);
for (const error of result.errors) console.error(error);
console.log(`Markdown check: ${result.documents} documents, ${result.relativeLinks} local links, ${result.tables} tables, ${result.errors.length} errors.`);
if (result.errors.length) process.exitCode = 1;
