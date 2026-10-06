import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readChangelog } from "./changelog-data.mjs";
import { validateReleaseScope } from "./lib/release-scope.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const audit = JSON.parse(read("scripts/data/audit-0.4.14.json"));
const expected = [4, 24, 17, 5].flatMap((count, priority) => Array.from({ length: count }, (_, index) => `P${priority}-${String(index + 1).padStart(2, "0")}`));
assert.deepEqual(audit.items.map((item) => item.id).sort(), expected.sort(), "All 50 audit IDs must occur exactly once");
const entries = readChangelog(root);
const changelog = entries.find((entry) => entry.version === "V0.4.14");
assert.ok(changelog, "Generated changelog entry is missing");
assert.equal(changelog.sections.length, 12);
assert.deepEqual(changelog.sections.flatMap((section) => section.auditIds).sort(), expected);
assert.equal(changelog.sections.reduce((total, section) => total + section.items.length, 0), 50);
assert.equal(changelog.isLatest, true);
assert.equal(entries.filter((entry) => entry.isLatest).length, 1, "Exactly one changelog entry must be latest");
for (const entry of entries) assert.equal(entry.sections.length % 2, 0, `${entry.version} sections must be even`);
assert.match(read("Src/Features/Settings/ChangelogData.ts"), /AUDIT_0414_CHANGELOG,/);
const statuses = new Set(["pending", "in-progress", "implemented", "verified", "external-blocked"]);
for (const item of audit.items) {
  assert.ok(statuses.has(item.status), `Invalid status for ${item.id}`);
  assert.ok(typeof item.userVisible === "string" && item.userVisible.length >= 30 && item.userVisible !== item.title,
    `${item.id} requires a concrete user-visible behavior description`);
  for (const key of ["implementation", "validation", "notes"]) assert.ok(Array.isArray(item[key]), `${item.id} ${key} must be an array`);
  if (item.status === "verified") {
    assert.ok(item.implementation.length > 0 && item.validation.length > 0, `${item.id} has no implementation or validation evidence`);
    assert.ok(item.desktopEvidence && item.negativeEvidence && item.documentationEvidence, `${item.id} has incomplete acceptance evidence`);
  }
}
for (const file of ["Docs/0.4.14-Audit-Plan.md", "Docs/0.4.14-Implementation-Status.md", "Docs/0.4.14-Security-and-Migration.md"]) assert.ok(read(file).length > 100);
assert.equal(JSON.parse(read("package.json")).version, "0.4.14");
assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).version, "0.4.14");
assert.match(read("src-tauri/Cargo.toml"), /^version = "0\.4\.14"$/m);
assert.match(read("src-tauri/Cargo.lock"), /name = "aurona_code"\r?\nversion = "0\.4\.14"/);
assert.match(read("README.md"), /version-0\.4\.14-/);
if (process.argv.includes("--complete")) {
  assert.ok(audit.freezeDate, "Release freeze date has not been recorded");
  const unfinished = audit.items.filter((item) => item.status !== "verified");
  assert.equal(unfinished.length, 0, `Release blocked by: ${unfinished.map((item) => item.id).join(", ")}`);
  assert.ok(audit.productionUpdaterEvidence && audit.productionMarketplaceEvidence && audit.candidateArtifactEvidence, "Production/candidate evidence is missing");
}
if (process.argv.includes("--release")) {
  validateReleaseScope(audit, audit.releaseScope ? read(audit.releaseScope.carryoverDocument) : "");
  if (audit.releaseScope) assert.ok(read(audit.releaseScope.decisionDocument).length > 100);
}
console.log(`0.4.14 audit contract passed: 50 IDs, 12 sections; ${audit.items.filter((item) => item.status === "verified").length} verified.`);
