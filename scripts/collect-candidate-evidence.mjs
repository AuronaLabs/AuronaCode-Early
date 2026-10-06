import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(process.argv[2] || path.join(root, "candidate/windows-x86_64"));
const status = JSON.parse(fs.readFileSync(path.join(output, "candidate-status.json"), "utf8"));
if (status.version !== "0.4.14" || status.releaseEligible) throw new Error("Expected an unreleased 0.4.14 local candidate");
const files = ["Docs/0.4.14-Audit-Plan.md", "Docs/0.4.14-Implementation-Status.md",
  "Docs/0.4.14-Security-and-Migration.md", "Docs/0.4.14-Acceptance-Report.md",
  "scripts/data/audit-0.4.14.json", "candidate/desktop-audit/desktop-report.json",
  "candidate/desktop-audit/build-provenance.json", ".quality-rust-0414.log", ".vitest-0414.log",
  ".git-recovery-0414.log", ".desktop-audit-0414.log"];
for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) throw new Error(`Missing candidate evidence: ${file}`);
  const destination = path.join(output, "verification", file.replace(/^candidate\//, ""));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
const records = [];
const scan = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Candidate evidence cannot contain linked files");
    if (entry.isDirectory()) scan(file);
    else if (!["SHA256SUMS", "EVIDENCE-SHA256SUMS", "cargo-arguments.json", "build-arguments.json"].includes(entry.name)) {
      const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      records.push(`${hash}  ${path.relative(output, file).replaceAll("\\", "/")}`);
    }
  }
};
scan(output);
fs.writeFileSync(path.join(output, "EVIDENCE-SHA256SUMS"), `${records.sort().join("\n")}\n`);
console.log(`Collected ${files.length} evidence files; candidate remains unreleased and production-blocked.`);
