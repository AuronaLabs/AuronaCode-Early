import test from "node:test";
import assert from "node:assert/strict";
import { trustedReleaseConfig, verifyCandidateTrust, verifyUpdaterPage } from "./lib/candidate-trust.mjs";
import { validateReleaseScope } from "./lib/release-scope.mjs";

test("release scope carries unfinished evidence forward without marking it verified", () => {
  const audit = { version: "0.4.14", freezeDate: "2026-10-06", items: [
    { id: "P0-03", status: "external-blocked", implementation: ["verifier"], notes: ["Production provenance remains"] },
  ], releaseScope: {
    decision: "formal-release-with-carryover", approvedOn: "2026-10-06", nextVersion: "0.4.15",
    decisionDocument: "Docs/0.4.14-Release-Decision.md", carryoverDocument: "Docs/0.4.15-Carryover-Plan.md",
    carryoverIds: ["P0-03"],
  } };
  validateReleaseScope(audit, "| P0-03 | remaining |\n");
  assert.equal(audit.items[0].status, "external-blocked");
  for (const modify of [
    (a) => { delete a.releaseScope; },
    (a) => { a.releaseScope.carryoverIds = []; },
    (a) => { a.releaseScope.carryoverIds.push("P0-03"); },
    (a) => { a.releaseScope.nextVersion = "0.5.0"; },
    (a) => { a.version = "0.4.15"; },
    (a) => { a.releaseScope.approvedOn = "2026-10-05"; },
  ]) {
    const changed = structuredClone(audit);
    modify(changed);
    assert.throws(() => validateReleaseScope(changed, "| P0-03 | remaining |\n"));
  }
  assert.throws(() => validateReleaseScope(audit, ""), /document/);
});

test("candidate cannot replace the pinned key or mix Stable and Pioneer channels", () => {
  const base = { version: "0.4.14", plugins: { updater: { pubkey: "trusted", endpoints: ["stable"] } } };
  const pioneer = { plugins: { updater: { endpoints: ["pioneer", "stable"] } } };
  const expected = trustedReleaseConfig(base, pioneer, "pioneer");
  verifyCandidateTrust(expected, expected);
  assert.equal(base.plugins.updater.endpoints[0], "stable");
  assert.throws(() => verifyCandidateTrust(base, expected), /endpoints/);
  const changed = structuredClone(expected);
  changed.plugins.updater.pubkey = "self-signed";
  assert.throws(() => verifyCandidateTrust(changed, expected), /public key/);
  changed.plugins.updater.pubkey = "trusted";
  changed.version = "0.4.13";
  assert.throws(() => verifyCandidateTrust(changed, expected), /version/);
});

test("aggregation checks the updater page against the separately verified signed payload", () => {
  const metadata = { version: "0.4.14", channel: "stable", artifacts: [
    { file: "app.exe", platform: "windows-x86_64", signature: "signed artifact" },
  ] };
  const page = { version: "0.4.14", auronaRelease: { metadata, signature: "signed metadata" },
    platforms: { "windows-x86_64": {
      url: "https://github.com/AuronaLabs/AuronaCode-Early/releases/download/v0.4.14/app.exe",
      signature: Buffer.from("signed artifact").toString("base64"),
    } } };
  verifyUpdaterPage(page, metadata, "signed metadata\n");
  const newlineSignature = structuredClone(page);
  newlineSignature.auronaRelease.signature += "\n";
  verifyUpdaterPage(newlineSignature, metadata, "signed metadata\n");
  for (const modify of [
    (p) => { p.platforms["windows-x86_64"].url = "https://attacker.example/app.exe"; },
    (p) => { p.auronaRelease.metadata.channel = "pioneer"; },
    (p) => { p.platforms["windows-x86_64"].signature = "tampered"; },
  ]) {
    const changed = structuredClone(page);
    modify(changed);
    assert.throws(() => verifyUpdaterPage(changed, metadata, "signed metadata"));
  }
});
