import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const aurxPath = join(root, "MarketplacePackages", "auronalabs.markdown.aurx");
const EXPECTED = ["manifest.json", "extension.wasm", "ui/index.html", "assets/icon.svg"];

function readEntries(data) {
  const eocdCandidates = [];
  for (let i = data.length - 22; i >= 0; i -= 1) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocdCandidates.push(i);
    }
  }
  if (eocdCandidates.length === 0) {
    throw new Error("AURX 缺少 EOCD");
  }
  const eocd = eocdCandidates[eocdCandidates.length - 1];
  const count = data.readUInt16LE(eocd + 10);
  const centralStart = data.readUInt32LE(eocd + 16);

  const entries = [];
  let position = centralStart;
  for (let i = 0; i < count; i += 1) {
    if (data.readUInt32LE(position) !== 0x02014b50) {
      throw new Error(`中央目录损坏于 ${position}`);
    }
    const crc = data.readUInt32LE(position + 16);
    const size = data.readUInt32LE(position + 24);
    const nameLength = data.readUInt16LE(position + 28);
    const extraLength = data.readUInt16LE(position + 30);
    const commentLength = data.readUInt16LE(position + 32);
    const localOffset = data.readUInt32LE(position + 42);
    const name = data.subarray(position + 46, position + 46 + nameLength).toString("utf8");

    const localHeaderSize = 30 + data.readUInt16LE(localOffset + 26);
    const content = data.subarray(localOffset + localHeaderSize, localOffset + localHeaderSize + size);
    if ((crc32(content) >>> 0) !== crc) {
      throw new Error(`CRC 校验失败: ${name}`);
    }
    entries.push({ name, content });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function main() {
  const data = readFileSync(aurxPath);
  const entries = readEntries(data);
  const names = entries.map((entry) => entry.name);
  if (names.length !== EXPECTED.length || EXPECTED.some((name) => !names.includes(name))) {
    throw new Error(`AURX 文件列表不符: ${names.join(", ")}`);
  }

  const manifest = JSON.parse(entries.find((entry) => entry.name === "manifest.json").content.toString("utf8"));
  if (manifest.packageVersion !== 1 || manifest.id !== "auronalabs.markdown" || manifest.publisher !== "auronalabs") {
    throw new Error("AURX manifest 无效");
  }
  const wasm = entries.find((entry) => entry.name === "extension.wasm").content;
  if (wasm.length < 4 || wasm.subarray(0, 4).toString("binary") !== "\0asm") {
    throw new Error("extension.wasm 不是有效 WASM");
  }
  const view = entries.find((entry) => entry.name === "ui/index.html").content.toString("utf8");
  if (!view.includes("Content-Security-Policy")) {
    throw new Error("插件 UI 缺少 CSP");
  }
  if (!view.includes("<!--AURONA_RENDER_SLOT-->")) {
    throw new Error("插件 UI 缺少渲染槽位");
  }
  const icon = entries.find((entry) => entry.name === "assets/icon.svg").content.toString("utf8");
  if (!icon.includes("<svg")) {
    throw new Error("插件图标无效");
  }

  console.log(`auronalabs.markdown.aurx 校验通过: ${aurxPath} (${data.length} bytes)`);
}

main();
