import assert from "node:assert/strict";

export function trustedReleaseConfig(base, pioneer, channel) {
  if (!["stable", "pioneer"].includes(channel)) throw new Error("Unknown release channel");
  const config = structuredClone(base);
  if (channel === "pioneer") {
    config.plugins.updater = { ...config.plugins.updater, ...pioneer.plugins.updater };
  }
  if (!config.plugins?.updater?.pubkey || !Array.isArray(config.plugins.updater.endpoints))
    throw new Error("Missing trusted updater configuration");
  return config;
}

export function verifyCandidateTrust(candidate, expected) {
  assert.equal(candidate.version, expected.version, "Candidate configuration version mismatch");
  assert.equal(candidate.plugins?.updater?.pubkey, expected.plugins.updater.pubkey,
    "Candidate public key does not match trusted repository configuration");
  assert.deepEqual(candidate.plugins?.updater?.endpoints, expected.plugins.updater.endpoints,
    "Candidate updater endpoints do not match the selected channel");
}

export function verifyUpdaterPage(page, metadata, metadataSignature) {
  assert.equal(page.version, metadata.version, "Updater page version mismatch");
  assert.deepEqual(page.auronaRelease?.metadata, metadata, "Updater page changed signed metadata");
  assert.equal(typeof page.auronaRelease?.signature, "string", "Updater page metadata signature is missing");
  assert.equal(page.auronaRelease.signature.trim(), metadataSignature.trim(), "Updater page metadata signature mismatch");
  assert.deepEqual(Object.keys(page.platforms).sort(), metadata.artifacts.map((a) => a.platform).sort(),
    "Updater page platform mismatch");
  const tag = metadata.channel === "pioneer" ? "pioneer-latest" : `v${metadata.version}`;
  for (const artifact of metadata.artifacts) {
    const entry = page.platforms[artifact.platform];
    const expectedUrl = `https://github.com/AuronaLabs/AuronaCode-Early/releases/download/${tag}/${encodeURIComponent(artifact.file)}`;
    assert.equal(entry.url, expectedUrl, "Updater page download URL mismatch");
    assert.equal(entry.signature, Buffer.from(artifact.signature).toString("base64"),
      "Updater page artifact signature mismatch");
  }
}
