import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// This deterministic, public test seed is never a production signing key.
const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 42)]), format: "der", type: "pkcs8" });
const publicBytes = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
const keyId = Buffer.alloc(8, 17);
const canonical = (value) => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);
const minisign = (data) => {
  const signature = sign(null, createHash("blake2b512").update(data).digest(), key);
  const comment = "timestamp:100\tfile:fixture\tprehashed";
  const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), key);
  return `untrusted comment: PUBLIC TEST FIXTURE ONLY\n${Buffer.concat([Buffer.from("ED"), keyId, signature]).toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`;
};
const root = path.resolve(import.meta.dirname, "../src-tauri/resources/security-fixtures");
fs.mkdirSync(root, { recursive: true });
const artifact = "aurona update fixture\n";
const artifactSignature = minisign(Buffer.from(artifact));
const metadata = { schemaVersion: 1, version: "0.4.14", channel: "stable", artifacts: [{ file: "fixture.exe", platform: "windows-x86_64", sha256: createHash("sha256").update(artifact).digest("hex"), sizeBytes: Buffer.byteLength(artifact), signature: artifactSignature }] };
const publicText = `untrusted comment: PUBLIC TEST FIXTURE ONLY\n${Buffer.concat([Buffer.from("Ed"), keyId, publicBytes]).toString("base64")}\n`;
const release = { artifact, config: { plugins: { updater: { pubkey: Buffer.from(publicText).toString("base64") } } }, auronaRelease: { metadata, signature: minisign(Buffer.from(canonical(metadata))) } };
fs.writeFileSync(path.join(root, "release-valid.json"), `${JSON.stringify(release, null, 2)}\n`);
const payload = { schemaVersion: 1, source: "https://marketplace.aurona.cc", revision: 8, issuedAt: 100, expiresAt: 200, request: "/api/extensions?page=1", nextPage: 2, entries: [{ id: "auronalabs.fixture", version: "1.0.0", publisher: "auronalabs", name: "Fixture" }] };
const catalog = { keyId: "public-test-fixture", payload, signature: sign(null, Buffer.from(canonical(payload)), key).toString("base64") };
const valid = { keys: { "public-test-fixture": publicBytes.toString("base64") }, catalog };
fs.writeFileSync(path.join(root, "catalog-valid.json"), `${JSON.stringify(valid, null, 2)}\n`);
const invalid = structuredClone(valid);
invalid.catalog.payload.entries[0].version = "2.0.0";
fs.writeFileSync(path.join(root, "catalog-tampered.json"), `${JSON.stringify(invalid, null, 2)}\n`);
console.log("Generated public test fixtures; no production signing configuration was changed.");
