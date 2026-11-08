import test from "node:test";
import assert from "node:assert/strict";
import { trustedReleaseConfig, verifyCandidateTrust, verifyUpdaterPage } from "./lib/candidate-trust.mjs";

test("candidate cannot replace the pinned key or updater endpoints", () => {
  const base = { version: "0.4.14", plugins: { updater: { pubkey: "trusted", endpoints: ["stable"] } } };
  const expected = trustedReleaseConfig(base);
  verifyCandidateTrust(expected, expected);
  assert.equal(base.plugins.updater.endpoints[0], "stable");
  const redirected = structuredClone(expected);
  redirected.plugins.updater.endpoints = ["untrusted"];
  assert.throws(() => verifyCandidateTrust(redirected, expected), /endpoints/);
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
    (p) => { p.auronaRelease.metadata.channel = "unknown"; },
    (p) => { p.platforms["windows-x86_64"].signature = "tampered"; },
  ]) {
    const changed = structuredClone(page);
    modify(changed);
    assert.throws(() => verifyUpdaterPage(changed, metadata, "signed metadata"));
  }
});
