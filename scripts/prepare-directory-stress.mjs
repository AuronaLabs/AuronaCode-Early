import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workspace = path.join(root, "candidate", "desktop-audit", "workspace");
assert.equal(fs.readFileSync(path.join(workspace, ".aurona-audit-workspace"), "utf8"), "isolated-0.4.14-acceptance");
const count = Number(process.argv[2] ?? 1_000_000);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 1_000_000);
const directory = path.join(workspace, "million-entries");
const marker = path.join(workspace, "directory-stress.json");
if (fs.existsSync(directory)) {
  assert.equal(JSON.parse(fs.readFileSync(marker, "utf8")).directory, directory);
} else {
  fs.mkdirSync(directory);
  fs.writeFileSync(marker, JSON.stringify({ directory, count: 0, completed: false }));
}
const disk = fs.statfsSync(workspace);
assert.ok(disk.bavail * disk.bsize > 2 * 1024 ** 3, "Stress preparation requires at least 2 GiB free space");
let next = 0;
let finished = 0;
const started = performance.now();
await Promise.all(Array.from({ length: 16 }, async () => {
  while (next < count) {
    const file = path.join(directory, `entry-${String(next++).padStart(7, "0")}`);
    try { const handle = await fs.promises.open(file, "wx"); await handle.close(); }
    catch (error) { if (error.code !== "EEXIST") throw error; assert.equal((await fs.promises.lstat(file)).size, 0); }
    finished++;
    if (finished % 100_000 === 0) console.log(`${finished}/${count} entries prepared (${((performance.now() - started) / 1000).toFixed(1)} s)`);
  }
}));
fs.writeFileSync(marker, JSON.stringify({ directory, count, completed: true, preparedAt: new Date().toISOString(),
  preparationMs: performance.now() - started, fixtureOnly: true }, null, 2));
console.log(`Real directory fixture ready: ${count} entries`);
