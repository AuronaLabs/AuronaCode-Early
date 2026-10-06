import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { trustedReleaseConfig, verifyCandidateTrust, verifyUpdaterPage } from "./lib/candidate-trust.mjs";

const root = path.resolve(process.argv[2] || "candidate-assets");
const files = fs.readdirSync(root, { recursive: true });
const manifests = files.filter((file) => path.basename(file) === "release-metadata.json");
if (manifests.length !== 5) throw new Error("All three updater candidates and both supplemental installers are required");
const verifier = path.resolve(import.meta.dirname, "../src-tauri/target/debug/examples/verify_candidate");
if (!fs.existsSync(verifier)) throw new Error("Build the verifier from the trusted checkout before aggregation");
const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const channel = process.env.RELEASE_TAG?.includes("-pioneer.") ? "pioneer" : "stable";
const repository = path.resolve(import.meta.dirname, "..");
const trusted = trustedReleaseConfig(
  JSON.parse(fs.readFileSync(path.join(repository, "src-tauri/tauri.conf.json"), "utf8")),
  JSON.parse(fs.readFileSync(path.join(repository, "src-tauri/tauri.pioneer.conf.json"), "utf8")), channel);
const trustedConfigFile = path.join(root, "trusted-tauri-config.json");
fs.writeFileSync(trustedConfigFile, JSON.stringify(trusted));
const merged = { version, pub_date: new Date().toISOString(), platforms: {}, auronaReleases: {} };
const updaterPlatforms = new Set(["windows-x86_64", "linux-x86_64", "darwin-aarch64", "darwin-x86_64"]);
const installerPlatforms = new Set(["darwin-universal-dmg", "linux-x86_64-deb"]);
const seenInstallers = new Set();
const verifiedArtifacts = [];
for (const manifest of manifests) {
  const directory = path.dirname(path.join(root, manifest));
  verifyCandidateTrust(JSON.parse(fs.readFileSync(path.join(directory, "merged-tauri-config.json"), "utf8")), trusted);
  execFileSync(verifier, [directory, version, channel, trustedConfigFile], { stdio: "inherit" });
  const page = JSON.parse(fs.readFileSync(path.join(directory, "latest.json"), "utf8"));
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, "release-metadata.json"), "utf8"));
  verifyUpdaterPage(page, metadata, fs.readFileSync(path.join(directory, "release-metadata.json.minisig"), "utf8"));
  if (page.version !== version || page.auronaRelease.metadata.channel !== channel) throw new Error("Candidate version/channel mismatch");
  const identity = metadata.artifacts.map((artifact) => artifact.platform).sort().join("-");
  fs.copyFileSync(path.join(directory, "release-metadata.json"), path.join(root, `release-metadata.${identity}.json`));
  fs.copyFileSync(path.join(directory, "release-metadata.json.minisig"), path.join(root, `release-metadata.${identity}.json.minisig`));
  verifiedArtifacts.push(...metadata.artifacts);
  for (const [platform, artifact] of Object.entries(page.platforms)) {
    if (installerPlatforms.has(platform)) {
      if (seenInstallers.has(platform)) throw new Error(`Duplicate installer ${platform}`);
      seenInstallers.add(platform);
      continue;
    }
    if (!updaterPlatforms.has(platform)) throw new Error(`Unexpected platform ${platform}`);
    if (merged.platforms[platform]) throw new Error(`Duplicate platform ${platform}`);
    merged.platforms[platform] = artifact;
    merged.auronaReleases[platform] = page.auronaRelease;
  }
}
for (const required of ["windows-x86_64", "linux-x86_64", "darwin-aarch64", "darwin-x86_64"])
  if (!merged.platforms[required]) throw new Error(`Missing ${required}`);
for (const required of installerPlatforms) if (!seenInstallers.has(required)) throw new Error(`Missing ${required}`);
fs.writeFileSync(path.join(root, "latest.json"), JSON.stringify(merged, null, 2));
const checksumFiles = new Map();
for (const artifact of verifiedArtifacts) {
  const previous = checksumFiles.get(artifact.file);
  if (previous && previous !== artifact.sha256) throw new Error(`Conflicting artifact filename ${artifact.file}`);
  checksumFiles.set(artifact.file, artifact.sha256);
}
fs.writeFileSync(path.join(root, "SHA256SUMS"), [...checksumFiles].map(([file, hash]) => `${hash}  ${file}`).join("\n") + "\n");
console.log("Candidate hashes, signatures, version and channel verified before manifest aggregation.");
