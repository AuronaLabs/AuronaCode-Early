import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findVcvars64 } from "./lib/extension-build-common.mjs";

const root = path.resolve(import.meta.dirname, "..");
const [input, destination, platform, channel = "stable"] = process.argv.slice(2);
if (!input || !destination || !platform || !["stable", "pioneer"].includes(channel))
  throw new Error("Usage: node scripts/prepare-candidate.mjs <artifact> <output-directory> <platform> [stable|pioneer]");
const source = path.resolve(input);
const output = path.resolve(destination);
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const filename = path.basename(source);
fs.mkdirSync(output, { recursive: true });
if (source !== path.join(output, filename)) fs.copyFileSync(source, path.join(output, filename));
if (fs.existsSync(`${source}.sig`) && `${source}.sig` !== path.join(output, `${filename}.sig`))
  fs.copyFileSync(`${source}.sig`, path.join(output, `${filename}.sig`));
else if (!fs.existsSync(`${source}.sig`) && fs.existsSync(path.join(output, `${filename}.sig`)))
  fs.unlinkSync(path.join(output, `${filename}.sig`));
for (const stale of ["release-metadata.json.sig", "release-metadata.json.minisig", "latest.json"]) {
  const file = path.join(output, stale);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
const config = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
if (channel === "pioneer") {
  const overlay = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.pioneer.conf.json"), "utf8"));
  config.plugins.updater = { ...config.plugins.updater, ...overlay.plugins.updater };
}
fs.writeFileSync(path.join(output, "merged-tauri-config.json"), JSON.stringify(config, null, 2));

function cargo(args) {
  if (process.platform !== "win32") {
    execFileSync("cargo", args, { cwd: root, stdio: "inherit" });
    return;
  }
  const vcvars = findVcvars64();
  if (!vcvars) throw new Error("VS2022 environment was not found");
  // Arguments are placed in a JSON file, never interpolated into cmd.exe.
  const taskFile = path.join(output, "cargo-arguments.json");
  fs.writeFileSync(taskFile, JSON.stringify(args));
  const helper = path.join(root, "scripts/run-cargo-arguments.mjs");
  execSync(`call "${vcvars}" && "${process.execPath}" "${helper}"`, {
    cwd: root, stdio: "inherit", env: { ...process.env, AURONA_CARGO_ARGUMENT_FILE: taskFile },
  });
  fs.unlinkSync(taskFile);
}
const common = ["run", ...(process.env.AURONA_CANDIDATE_RELEASE === "1" ? ["--release"] : []), "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--example"];
cargo([...common, "prepare_candidate", "--", output, version, channel, platform, filename]);
const canSign = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH);
let verified = false;
if (canSign) {
  const metadata = path.join(output, "release-metadata.json");
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/@tauri-apps/cli/tauri.js"), "signer", "sign", metadata], {
      cwd: root, stdio: "pipe",
    });
  } catch { throw new Error("Candidate signature creation failed; candidate files are preserved."); }
  const encoded = fs.readFileSync(`${metadata}.sig`, "utf8").trim();
  const signature = encoded.startsWith("untrusted comment:") ? encoded : Buffer.from(encoded, "base64").toString("utf8");
  fs.writeFileSync(`${metadata}.minisig`, signature);
  cargo([...common, "verify_candidate", "--", output, version, channel, path.join(output, "merged-tauri-config.json")]);
  verified = true;
  const verifier = path.join(root, "src-tauri/target", process.env.AURONA_CANDIDATE_RELEASE === "1" ? "release" : "debug", "examples", `verify_candidate${process.platform === "win32" ? ".exe" : ""}`);
  if (process.platform === "linux") fs.copyFileSync(verifier, path.join(output, "verify_candidate"));
  const payload = JSON.parse(fs.readFileSync(metadata, "utf8"));
  const tag = channel === "pioneer" ? "pioneer-latest" : `v${version}`;
  fs.writeFileSync(path.join(output, "latest.json"), JSON.stringify({
    version, pub_date: new Date().toISOString(),
    platforms: Object.fromEntries(payload.artifacts.map((artifact) => [artifact.platform, {
      url: `https://github.com/AuronaLabs/AuronaCode-Early/releases/download/${tag}/${encodeURIComponent(artifact.file)}`,
      signature: Buffer.from(artifact.signature).toString("base64"),
    }])), auronaRelease: { metadata: payload, signature },
  }, null, 2));
}
fs.writeFileSync(path.join(output, "candidate-status.json"), JSON.stringify({
  version, channel, platform, artifact: filename, signedAndVerified: verified,
  artifactSha256: JSON.parse(fs.readFileSync(path.join(output, "release-metadata.json"), "utf8")).artifacts[0].sha256,
  configSha256: createHash("sha256").update(fs.readFileSync(path.join(output, "merged-tauri-config.json"))).digest("hex"),
  releaseEligible: false,
  remaining: ["50-item release acceptance gate", "production updater provenance", "production Marketplace signatures", "desktop and cross-platform acceptance"],
}, null, 2));
console.log(verified ? "Local candidate signatures verified; release acceptance still required." : "Unsigned local candidate retained. Production signature verification is blocked.");
