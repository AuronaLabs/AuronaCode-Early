import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const filename = path.join(root, "scripts/data/audit-0.4.14.json");
const audit = JSON.parse(fs.readFileSync(filename, "utf8"));
const evidence = {
  "P0-01": ["Root delete/rename/move IPC rejection", "Native delete confirmation/cancel/restore, junction aliases and crash recovery remain."],
  "P0-02": ["Metadata endpoint IPC rejection", "Approved credential-bearing provider/loopback, redirect and DNS workflows remain."],
  "P0-04": ["Sanitized sandbox iframe script and external-resource probe", "Actual extension icon rendering and dynamic theme regressions remain."],
  "P1-01": ["Forged source scope rejected; scoped copy/move preserves bytes", "Native drag/drop and concurrent target replacement remain."],
  "P1-03": ["Chunked Unicode upload, bad offset/reuse rejection, cancellation and oversized reads", "Growing-file and maximum-size editor save workflows remain."],
  "P1-04": ["100 native watcher cycles and 100000 real writes; final state and stopped-event checks", "Broaden distinct-path overflow/cache-invalidation and repeated resource trends."],
  "P1-05": ["Scoped init/status/stage/commit/unstage; external repository and pathspec traversal rejected", "Explicit parent/submodule authorization remains."],
  "P1-10": ["Unregistered LSP direct IPC rejection", "Approved third-party local and signed installed server workflows remain."],
  "P1-12": ["Unregistered DAP direct IPC rejection", "Approved local debugging and authorization cancellation remain."],
  "P1-17": ["Host sanitizer iframe cannot inject script or external requests in WebView2", "Full runtime dynamic rendering and theme corpus remain."],
  "P1-24": ["Editor, save/conflict, Markdown and iframe run under production CSP in isolated WebView2", "Production identity capabilities, Account and update/installer acceptance remain."],
  "P2-01": ["Million actual entries, 30 first-page/cancel runs and virtual Explorer pagination", "Optimized candidate baseline comparison, RSS trends and generation invalidation remain."],
  "P2-10": ["Unapproved initial cwd rejected; approved workspace cwd spawns PTY", "Native external-directory authorization and trust display remain."],
  "P2-11": ["High-output PTY batches acknowledged; oversized/closed input rejected; bounded exit", "Full descendant/RSS lifecycle trends and idle-session acceptance remain."],
  "P3-01": ["100 real tabs, at most 12 mounted editors, dirty eviction, Markdown mode and Ctrl+S", "Inactive Canvas/subscription counters, retained settings drafts and optimized baseline remain."],
  "P3-02": ["Real editor save rejects same-size/same-mtime external rewrite", "Save I/O baseline and final concurrent-write interval remain."],
  "P3-05": ["Iframe image/font/CSS/script/form/navigation fixture causes no external requests", "Runtime-installed extension and larger local-resource corpus remain."],
};
for (const item of audit.items) {
  assert.equal(item.documentationEvidence, true);
  const references = item.coverage.map((reference) =>
    `Automated coverage: ${reference}; local suite results and qualifications in Docs/0.4.14-Acceptance-Report.md`);
  item.validation = references;
  if (evidence[item.id]) {
    const [scope, remaining] = evidence[item.id];
    item.validation.push(`Partial desktop evidence: ${scope}; candidate/desktop-audit/desktop-report.json (isolated debug harness, not candidate/native approval acceptance)`);
    item.notes = [remaining];
  }
  // Partial records cannot set the final acceptance flags or unlock a release.
  item.desktopEvidence = false;
  item.negativeEvidence = false;
}
fs.writeFileSync(filename, `${JSON.stringify(audit, null, 2)}\n`);
console.log("Recorded qualified partial evidence; final acceptance statuses are unchanged.");
