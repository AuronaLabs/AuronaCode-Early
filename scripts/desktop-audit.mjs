import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { buildSync } from "esbuild";
import { artifactSha256, sourceProvenance } from "./lib/audit-provenance.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "candidate", "desktop-audit");
const config = JSON.parse(fs.readFileSync(path.join(output, "harness-config.json"), "utf8"));
const provenance = JSON.parse(fs.readFileSync(path.join(output, "build-provenance.json"), "utf8"));
assert.equal(provenance.sourceSha256, sourceProvenance(root).sourceSha256, "Audit binary is stale; rebuild before recording evidence");
assert.equal(provenance.artifactSha256, artifactSha256(path.join(output, "Aurona Code Audit.exe")), "Audit binary changed after build");
assert.equal(config.identifier, "com.aurona.code.audit0414");
const workspace = config.workspace;
assert.equal(fs.readFileSync(path.join(workspace, ".aurona-audit-workspace"), "utf8"), "isolated-0.4.14-acceptance");
const runtime = process.env.AURONA_PLAYWRIGHT_ROOT ?? "C:/Users/ecosp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = createRequire(import.meta.url)(runtime);
const guard = net.createServer();
await new Promise((resolve, reject) => guard.once("error", reject).listen(9441, "127.0.0.1", resolve));
await new Promise((resolve) => guard.close(resolve));
const processHandle = spawn(path.join(output, "Aurona Code Audit.exe"), [], {
  cwd: output, windowsHide: true, env: { ...process.env, AURONA_AUDIT_ROOT: workspace }, stdio: "ignore",
});
let browser;
let page;
const records = [];
const resources = () => JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  `$p=Get-Process -Id ${processHandle.pid}; @{rssBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64;threads=$p.Threads.Count;handles=$p.HandleCount}|ConvertTo-Json -Compress`],
  { encoding: "utf8", windowsHide: true }));
const report = { version: "0.4.14", generatedAt: new Date().toISOString(), candidateAcceptance: false,
  provenance, driverSha256: artifactSha256(path.join(root, "scripts", "desktop-audit.mjs")),
  hardware: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model,
    logicalProcessors: os.cpus().length, totalMemoryBytes: os.totalmem() },
  runScope: process.argv.includes("--ui-only") ? "UI-only diagnostic run" : "full desktop audit",
  configuration: "Isolated audit identifier, production CSP, audit-only workspace approval; native approvals and candidate installer remain unverified.", records };
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (processHandle.exitCode !== null) throw new Error(`Audit process exited (${processHandle.exitCode}) before CDP connected`);
    try { browser = await chromium.connectOverCDP("http://127.0.0.1:9441"); break; } catch { await delay(200); }
  }
  assert.ok(browser, "WebView2 CDP was unavailable");
  for (let attempt = 0; attempt < 100; attempt++) {
    page = browser.contexts().flatMap((context) => context.pages()).find((page) => !page.url().includes("splash"));
    if (page && await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__)).catch(() => false)) break;
    await delay(200);
  }
  assert.ok(page, "Main WebView was not created");
  // The bootstrapper initializes (and may clear) the backend workspace before
  // rendering main. Sending audit IPC earlier races with that initialization.
  await page.locator("main").first().waitFor({ state: "attached", timeout: 60_000 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const invoke = (command, args = {}) => page.evaluate(async ({ command, args }) => {
    try { return { ok: true, value: await window.__TAURI_INTERNALS__.invoke(command, args) }; }
    catch (error) { return { ok: false, error: typeof error === "object" ? JSON.stringify(error) : String(error) }; }
  }, { command, args });
  const check = async (name, command, args, expected, errorCode) => {
    const start = performance.now();
    const result = await invoke(command, args);
    assert.equal(result.ok, expected, `${name}: ${JSON.stringify(result)}`);
    if (errorCode) assert.ok(result.error?.includes(`[${errorCode}]`), `${name}: ${JSON.stringify(result)}`);
    records.push({ name, command, passed: true, ms: performance.now() - start,
      error: result.error, value: typeof result.value === "string" && result.value.length > 500 ? "bounded text" : result.value });
    return result.value;
  };
  if (!process.argv.includes("--ui-only")) {
  await check("storage traversal", "app_storage_read", { area: "data", path: "../user-config.json" }, false);
  await check("unselected file", "fs_read_text_file", { path: path.join(workspace, "unknown.txt") }, false);
  await check("unregistered LSP", "lsp_start", { language: "typescript", launchId: "forged" }, false);
  await check("unregistered DAP", "dap_start", { launchId: "forged" }, false);
  await check("dangerous AI URL", "ai_profile_save", { profile: { id: "bad", name: "bad", provider: "custom", model: "bad", protocol: "responses",
    baseUrl: "http://169.254.169.254", credentialId: "bad", hasCredential: false }, apiKey: null }, false);
  await check("IPv6 documentation AI URL", "ai_profile_save", { profile: { id: "bad-ipv6", name: "bad", provider: "custom", model: "bad", protocol: "responses",
    baseUrl: "https://[3fff::1]/v1", credentialId: "bad-ipv6", hasCredential: false }, apiKey: null }, false, "network.address");
  await check("workspace authorization", "workspace_set_root", { root: workspace }, true);
  for (const target of [workspace, `${workspace}${path.sep}.`]) {
    await check("root delete alias", "fs_remove", { path: target, recursive: true }, false, "workspace.root_protected");
  }
  await check("root delete empty", "fs_remove", { path: "", recursive: true }, false);
  await check("root rename denied", "fs_rename", { from: workspace, to: path.join(workspace, "renamed-root") }, false, "workspace.root_protected");
  await check("root move denied", "fs_copy_or_move", { source: workspace, destination: path.join(workspace, "moved-root"), isMove: true }, false, "workspace.root_protected");
  await check("forged source root", "fs_copy_or_move", { source: path.join(root, "README.md"), destination: path.join(workspace, "escape.txt"), isMove: false, workspaceRoot: root }, false);
  const textPath = path.join(workspace, "unicode.txt");
  await check("scoped Unicode write", "fs_write_text_file", { path: textPath, contents: "Aurona 中文 😀\n" }, true);
  assert.equal(await check("scoped Unicode read", "fs_read_text_file", { path: textPath }, true), "Aurona 中文 😀\n");
  const generation = await check("generation", "workspace_generation", {}, true);
  await check("stale save generation", "fs_write_compare", { path: textPath, contents: "wrong", expectedFingerprint: "wrong", generation: generation - 1 }, false);
  const copied = path.join(workspace, "copied.txt");
  const moved = path.join(workspace, "moved.txt");
  for (const file of [copied, moved]) if (fs.existsSync(file)) fs.unlinkSync(file);
  await check("scoped copy", "fs_copy_or_move", { source: textPath, destination: copied, isMove: false }, true);
  await check("scoped move", "fs_copy_or_move", { source: copied, destination: moved, isMove: true }, true);
  assert.equal(fs.readFileSync(moved, "utf8"), fs.readFileSync(textPath, "utf8"));
  assert.equal(fs.existsSync(copied), false);
  const uploadPath = path.join(workspace, "chunked.txt");
  const uploadText = "chunk \u{1f600}\n".repeat(40_000);
  const uploadId = await check("chunk upload begin", "fs_write_begin", { path: uploadPath, sizeBytes: Buffer.byteLength(uploadText) }, true);
  await check("chunk upload wrong offset", "fs_write_chunk", { uploadId, offset: 1, contents: "wrong" }, false, "file.upload");
  let offset = 0;
  for (let index = 0; index < 4; index++) {
    const contents = "chunk \u{1f600}\n".repeat(10_000);
    await check("chunk upload part", "fs_write_chunk", { uploadId, offset, contents }, true);
    offset += Buffer.byteLength(contents);
  }
  await check("chunk upload commit", "fs_write_commit", { uploadId }, true);
  assert.equal(fs.readFileSync(uploadPath, "utf8"), uploadText);
  await check("chunk upload reuse", "fs_write_commit", { uploadId }, false, "file.upload");
  const cancelledUpload = await check("cancelled upload begin", "fs_write_begin", { path: uploadPath, sizeBytes: 100 }, true);
  await check("cancelled upload cleanup", "fs_write_cancel", { uploadId: cancelledUpload }, true);
  assert.equal(fs.readFileSync(uploadPath, "utf8"), uploadText);
  assert.ok(!fs.readdirSync(workspace).some((file) => file.startsWith(".aurona-save-")));
  const largePath = path.join(workspace, "oversized.txt");
  fs.writeFileSync(largePath, Buffer.alloc(32 * 1024 * 1024 + 1, 120));
  try {
    await check("oversized text read", "fs_read_text_file", { path: largePath }, false, "resource.limit");
    await check("oversized editor open", "open_editor_file", { path: largePath }, false);
  } finally { fs.unlinkSync(largePath); }
  const editPath = path.join(workspace, "editor-flow.txt");
  fs.writeFileSync(editPath, "before");
  const opened = await check("editor open", "open_editor_file", { path: editPath }, true);
  const edited = await check("editor edit", "apply_editor_edits", { request: { path: editPath, baseRevision: opened.revision,
    clientBatchId: "audit-edit", edits: [{ startUtf16: 0, endUtf16: 6, text: "after!" }] } }, true);
  await check("dirty editor close rejected", "close_editor_file", { path: editPath, force: false }, false);
  const saved = await check("editor save", "save_editor_file", { request: { path: editPath, expectedRevision: edited.revision,
    diskFingerprint: opened.diskFingerprint } }, true);
  assert.equal(fs.readFileSync(editPath, "utf8"), "after!");
  const metadata = fs.statSync(editPath);
  fs.writeFileSync(editPath, "other!"); fs.utimesSync(editPath, metadata.atime, metadata.mtime);
  await check("same size and mtime external conflict", "save_editor_file", { request: { path: editPath,
    expectedRevision: saved.revision, diskFingerprint: saved.diskFingerprint } }, false);
  assert.equal(fs.readFileSync(editPath, "utf8"), "other!");
  await check("editor force close", "close_editor_file", { path: editPath, force: true }, true);
  await check("unapproved terminal cwd", "spawn_pty", { id: "audit-denied", sessionId: "audit-denied", cwd: root, shellPath: "cmd.exe" }, false, "workspace.boundary");
  await page.evaluate(async () => {
    const internal = window.__TAURI_INTERNALS__;
    window.__auditPty = { bytes: 0, events: 0, text: "", exited: false };
    window.__auditPtyListeners = [];
    for (const event of ["pty-output", "pty-exit"]) {
      const handler = internal.transformCallback(({ payload }) => {
        if (payload.id !== "audit-output") return;
        if (event === "pty-exit") { window.__auditPty.exited = true; return; }
        const text = atob(payload.data);
        window.__auditPty.bytes += text.length;
        window.__auditPty.events++;
        window.__auditPty.text = (window.__auditPty.text + text).slice(-4096);
        void internal.invoke("acknowledge_pty", { id: payload.id, sessionId: payload.session_id, seq: payload.seq });
      });
      const id = await internal.invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler });
      window.__auditPtyListeners.push({ event, id, handler });
    }
  });
  await check("authorized terminal", "spawn_pty", { id: "audit-output", sessionId: "audit-output", cwd: workspace, shellPath: "cmd.exe" }, true);
  await check("terminal input quota", "write_pty", { id: "audit-output", data: "x".repeat(64 * 1024 + 1) }, false);
  // cmd's FOR prints two MiB without loading user shell profiles or changing files.
  await check("terminal high output", "write_pty", { id: "audit-output", data: `for /L %i in (1,1,32768) do @echo ${"x".repeat(64)}\r\necho AURONA_AUDIT_OUTPUT_DONE\r\n` }, true);
  await page.waitForFunction(() => window.__auditPty.bytes >= 2 * 1024 * 1024 && window.__auditPty.text.includes("AURONA_AUDIT_OUTPUT_DONE"), null, { timeout: 120_000 });
  records.push({ name: "PTY two MiB output with acknowledged batches", passed: true, ...await page.evaluate(() => window.__auditPty), text: undefined });
  const closeStart = performance.now();
  await check("terminal close", "close_pty", { id: "audit-output", sessionId: "audit-output" }, true);
  await page.waitForFunction(() => window.__auditPty.exited, null, { timeout: 2000 });
  records.push({ name: "PTY close reaches exit", passed: true, ms: performance.now() - closeStart });
  await check("closed terminal rejects input", "write_pty", { id: "audit-output", data: "wrong" }, false);
  await check("Git external repository denied", "git_status", { path: root }, false);
  const gitDirectory = path.join(workspace, `git-run-${report.generatedAt.replaceAll(/[:.]/g, "-")}`);
  report.gitDirectory = gitDirectory;
  fs.mkdirSync(gitDirectory, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", gitDirectory, ...args], { windowsHide: true, encoding: "utf8" });
  if (!fs.existsSync(path.join(gitDirectory, ".git"))) {
    await check("Git scoped initialization", "git_init", { path: gitDirectory }, true);
    git("config", "user.name", "Aurona Audit"); git("config", "user.email", "audit@example.invalid");
    fs.writeFileSync(path.join(gitDirectory, "tracked.txt"), "initial");
    await check("Git scoped stage", "git_add", { path: gitDirectory, file: "tracked.txt" }, true);
    await check("Git scoped commit", "git_commit", { path: gitDirectory, message: "Isolated audit fixture" }, true);
  }
  fs.writeFileSync(path.join(gitDirectory, "tracked.txt"), "changed");
  const gitStatus = await check("Git scoped status", "git_status", { path: gitDirectory }, true);
  assert.ok(gitStatus.some((file) => file.path === "tracked.txt"));
  await check("Git pathspec traversal rejected", "git_add", { path: gitDirectory, file: "../unicode.txt" }, false);
  await check("Git scoped stage change", "git_add", { path: gitDirectory, file: "tracked.txt" }, true);
  await check("Git scoped unstage change", "git_unstage", { path: gitDirectory, file: "tracked.txt" }, true);
  console.log("Direct IPC, chunked file/editor and high-output PTY checks passed.");
  await page.evaluate(async () => {
    for (const { event, id, handler } of window.__auditPtyListeners) {
      window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, id);
      await window.__TAURI_INTERNALS__.invoke("plugin:event|unlisten", { event, eventId: id });
      window.__TAURI_INTERNALS__.unregisterCallback(handler);
    }
  });
  const samples = [];
  const watchDirectory = path.join(workspace, "watch-events");
  fs.mkdirSync(watchDirectory, { recursive: true });
  await page.evaluate(async () => {
    window.__auditWatch = { events: 0, paths: 0, maxPaths: 0, overflow: 0, id: null };
    const handler = window.__TAURI_INTERNALS__.transformCallback(({ payload }) => {
      if (payload.id !== window.__auditWatch.id) return;
      window.__auditWatch.events++;
      window.__auditWatch.paths += payload.paths.length;
      window.__auditWatch.maxPaths = Math.max(window.__auditWatch.maxPaths, payload.paths.length);
      if (payload.kind === "overflow") window.__auditWatch.overflow++;
    });
    const eventId = await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", { event: "fs:changed", target: { kind: "Any" }, handler });
    window.__auditWatchListener = { eventId, handler };
  });
  const watcherStart = () => invoke("fs_watch_start", { path: watchDirectory, recursive: false });
  for (let cycle = 0; cycle < 5; cycle++) {
    const watch = await watcherStart(); assert.equal(watch.ok, true);
    assert.equal((await invoke("fs_watch_stop", { id: watch.value })).ok, true);
  }
  await delay(250);
  const resourceSamples = [{ cycle: 0, ...resources() }];
  for (let cycle = 1; cycle <= 100; cycle++) {
    const watch = await watcherStart(); assert.equal(watch.ok, true);
    fs.writeFileSync(path.join(watchDirectory, "lifecycle.txt"), String(cycle));
    assert.equal((await invoke("fs_watch_stop", { id: watch.value })).ok, true);
    await delay(20);
    if (cycle % 20 === 0) { await delay(150); resourceSamples.push({ cycle, ...resources() }); }
  }
  const watch = await watcherStart(); assert.equal(watch.ok, true);
  await page.evaluate((id) => { window.__auditWatch.id = id; }, watch.value);
  const latest = new Map();
  const mutationStart = performance.now();
  for (let index = 0; index < 100_000; index++) {
    const name = `changed-${index % 64}.txt`; const content = `latest-${index}`;
    fs.writeFileSync(path.join(watchDirectory, name), content); latest.set(name, content);
    if (index > 0 && index % 10_000 === 0) console.log(`Watcher stress: ${index}/100000 changes`);
  }
  await page.waitForFunction(() => window.__auditWatch.events > 0);
  await delay(250);
  assert.equal((await invoke("fs_watch_stop", { id: watch.value })).ok, true);
  await delay(250);
  const eventCount = await page.evaluate(() => window.__auditWatch.events);
  fs.writeFileSync(path.join(watchDirectory, "after-stop.txt"), "stopped");
  await delay(250);
  const watcherMetrics = await page.evaluate(() => window.__auditWatch);
  assert.equal(watcherMetrics.events, eventCount, "Stopped watcher emitted another event");
  assert.ok(watcherMetrics.maxPaths <= 4096);
  for (const [name, content] of latest) {
    const read = await invoke("fs_read_text_file", { path: path.join(watchDirectory, name) });
    assert.equal(read.ok, true); assert.equal(read.value, content);
  }
  resourceSamples.push({ cycle: 100, afterEventStress: true, ...resources() });
  records.push({ name: "Native watcher 100 lifecycle cycles and 100000 changes", passed: true,
    mutationMs: performance.now() - mutationStart, resourceSamples, watcherMetrics,
    operatingSystemEventCoalescing: true, resourceTrendAcceptance: false });
  console.log("Native watcher lifecycle and event stress checks passed.");
  await page.evaluate(async () => {
    const { eventId, handler } = window.__auditWatchListener;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener("fs:changed", eventId);
    await window.__TAURI_INTERNALS__.invoke("plugin:event|unlisten", { event: "fs:changed", eventId });
    window.__TAURI_INTERNALS__.unregisterCallback(handler);
  });
  for (let index = 0; index < 30; index++) {
    const start = performance.now();
    const result = await invoke("fs_read_dir_page", { path: workspace, cursor: null });
    assert.equal(result.ok, true, JSON.stringify(result));
    samples.push(performance.now() - start);
    assert.ok(result.value.entries.length <= 256);
    if (result.value.nextCursor) await invoke("fs_cancel_dir_cursor", { cursor: result.value.nextCursor });
  }
  samples.sort((a, b) => a - b);
  records.push({ name: "directory IPC latency (small isolated workspace)", passed: true, runs: samples.length,
    p50Ms: samples[15], p95Ms: samples[28], millionEntryAcceptance: false });
  if (process.argv.includes("--stress-directory")) {
    const fixture = JSON.parse(fs.readFileSync(path.join(workspace, "directory-stress.json"), "utf8"));
    assert.equal(fixture.count, 1_000_000); assert.equal(fixture.completed, true);
    assert.equal(fixture.directory, path.join(workspace, "million-entries"));
    const times = []; const cancels = [];
    for (let iteration = 0; iteration < 30; iteration++) {
      const start = performance.now();
      const pageResult = await invoke("fs_read_dir_page", { path: fixture.directory, cursor: null });
      assert.equal(pageResult.ok, true, JSON.stringify(pageResult));
      assert.equal(pageResult.value.entries.length, 256);
      assert.ok(pageResult.value.nextCursor);
      times.push(performance.now() - start);
      const cancel = performance.now();
      assert.equal((await invoke("fs_cancel_dir_cursor", { cursor: pageResult.value.nextCursor })).ok, true);
      cancels.push(performance.now() - cancel);
      assert.equal((await invoke("fs_read_dir_page", { path: fixture.directory, cursor: pageResult.value.nextCursor })).ok, false);
    }
    times.sort((a, b) => a - b); cancels.sort((a, b) => a - b);
    records.push({ name: "Million real entries: bounded first page and cancellation", passed: true, entries: fixture.count, runs: 30,
      p50Ms: times[15], p95Ms: times[28], cancelP50Ms: cancels[15], cancelP95Ms: cancels[28], pageEntries: 256,
      baselineComparison: false, processRssAcceptance: false });
    console.log("Million-entry first-page/cancel checks passed.");
  }
  }
  const bundled = buildSync({ entryPoints: [path.join(root, "Src/Foundation/Security/ExtensionContent.ts")], bundle: true,
    format: "iife", globalName: "AuronaAuditContent", write: false, platform: "browser", minify: true }).outputFiles[0].text;
  await page.evaluate(`${bundled}\nwindow.AuronaAuditContent = AuronaAuditContent;`);
  const remoteRequests = [];
  page.on("request", (request) => { if (request.url().includes("aurona-audit.invalid")) remoteRequests.push(request.url()); });
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "");
    frame.setAttribute("id", "audit-extension-frame");
    frame.srcdoc = window.AuronaAuditContent.sanitizeExtensionDocument(`<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><style>@import 'https://aurona-audit.invalid/theme.css';@font-face{font-family:x;src:url(https://aurona-audit.invalid/font)}body{background:url(https://aurona-audit.invalid/bg)}</style></head><body><script>parent.__auditInjected=true</script><img src="https://aurona-audit.invalid/image" onerror="parent.__auditInjected=true"><form action="https://aurona-audit.invalid/post"><input></form><a href="https://aurona-audit.invalid/nav">navigation</a><p>safe audit content</p></body></html>`);
    document.body.append(frame);
  });
  await delay(1000);
  assert.equal(remoteRequests.length, 0);
  assert.equal(await page.evaluate(() => Boolean(window.__auditInjected)), false);
  records.push({ name: "sanitized sandbox iframe in WebView2", passed: true, remoteRequests: remoteRequests.length, injectedScript: false });
  await page.evaluate(() => document.getElementById("audit-extension-frame")?.remove());
  // Reloading a WebView does not clear Rust editor sessions or recovery data.
  // Fresh file identities keep repeated audit runs from overwriting live buffers.
  const uiDirectory = path.join(workspace, `ui-run-${report.generatedAt.replaceAll(/[:.]/g, "-")}`);
  fs.mkdirSync(uiDirectory);
  report.uiDirectory = uiDirectory;
  const tabs = Array.from({ length: 100 }, (_, index) => {
    const title = `audit-tab-${String(index).padStart(2, "0")}.${index === 0 ? "md" : "txt"}`;
    const file = path.join(uiDirectory, title);
    fs.writeFileSync(file, index === 0 ? "# Audit Markdown\n\nOriginal draft.\n" : `tab ${index}\n`);
    return { id: file, type: "file", title, path: file, isDirty: false };
  });
  await check("isolated UI configuration", "app_storage_write", { area: "data", path: "user-config.json",
    append: false, content: JSON.stringify({ locale: "en", theme: "dark", editorCapsuleEnabled: true }) }, true);
  await check("one hundred persisted tabs", "app_storage_write", { area: "data", path: "workspace.json", append: false,
    content: JSON.stringify({ lastOpenedPath: workspace, openTabs: tabs, activeTabId: tabs[0].id,
      activeSidebar: "\u8d44\u6e90\u7ba1\u7406\u5668", isBottomPanelOpen: false }) }, true);
  await page.reload();
  await page.locator("[role=tab][data-tab-id]").last().waitFor({ state: "attached", timeout: 60_000 });
  assert.equal(await page.locator("[role=tab][data-tab-id]").count(), 100);
  if (process.argv.includes("--stress-directory")) {
    const tree = page.getByRole("tree");
    await tree.waitFor({ state: "visible" });
    const directory = path.join(workspace, "million-entries").replaceAll("\\", "/");
    const scrollToPath = async (target) => {
      await tree.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      for (let step = 0; step < 100; step++) {
        if (await tree.locator("[data-file-path]").evaluateAll((rows, target) => rows.some((row) => row.dataset.filePath.replaceAll("\\", "/") === target), target)) return;
        await tree.evaluate((element) => { element.scrollTop += Math.max(100, element.clientHeight - 56); });
        await delay(30);
      }
      throw new Error(`Explorer row was not reachable: ${target}`);
    };
    await scrollToPath(directory);
    const before = resources();
    const start = performance.now();
    await tree.locator("[data-file-path]").evaluateAll((rows, target) => rows.find((row) => row.dataset.filePath.replaceAll("\\", "/") === target).click(), directory);
    await page.waitForFunction((directory) => Array.from(document.querySelectorAll('[role=tree] [data-file-path]'))
      .some((row) => row.dataset.filePath.replaceAll("\\", "/").startsWith(`${directory}/`)), directory);
    const firstRenderMs = performance.now() - start;
    let maxMountedRows = await tree.getByRole("treeitem").count();
    const loadMore = tree.getByRole("button", { name: "Load More", exact: true });
    for (let step = 0; step < 30 && !await loadMore.isVisible(); step++) {
      await tree.evaluate((element) => { element.scrollTop += Math.max(100, element.clientHeight - 56); });
      await delay(30);
      maxMountedRows = Math.max(maxMountedRows, await tree.getByRole("treeitem").count());
    }
    const explorerState = await tree.evaluate((element) => ({ top: element.scrollTop, height: element.clientHeight,
      scrollHeight: element.scrollHeight, buttons: Array.from(element.querySelectorAll("button")).map((button) => button.textContent),
      rows: Array.from(element.querySelectorAll("[data-file-path]")).map((row) => row.dataset.filePath) }));
    assert.equal(await loadMore.isVisible(), true, `Million-entry directory requires a reachable page control: ${JSON.stringify(explorerState)}`);
    const heightBefore = await tree.evaluate((element) => element.scrollHeight);
    await loadMore.click();
    await page.waitForFunction((height) => document.querySelector('[role=tree]').scrollHeight > height, heightBefore);
    maxMountedRows = Math.max(maxMountedRows, await tree.getByRole("treeitem").count());
    assert.ok(maxMountedRows <= 100, `Explorer mounted ${maxMountedRows} rows`);
    await tree.focus();
    await tree.press("ArrowLeft");
    await page.waitForFunction((directory) => !Array.from(document.querySelectorAll('[role=tree] [data-file-path]'))
      .some((row) => row.dataset.filePath.replaceAll("\\", "/").startsWith(`${directory}/`)), directory);
    records.push({ name: "Million-entry Explorer: render, pagination and virtual rows", passed: true,
      firstRenderMs, maxMountedRows, before, after: resources(), baselineComparison: false });
    console.log("Million-entry Explorer render/pagination checks passed.");
  }
  const selectTab = async (index) => {
    const start = performance.now();
    await page.locator("[role=tab][data-tab-id]").nth(index).evaluate((element) => element.click());
    await page.waitForFunction((id) => Array.from(document.querySelectorAll("[role=tab][data-tab-id]"))
      .some((tab) => tab.getAttribute("data-tab-id") === id && tab.getAttribute("aria-selected") === "true"), tabs[index].id);
    await page.waitForFunction(() => Array.from(document.querySelectorAll("textarea"))
      .some((element) => element.getBoundingClientRect().width > 0));
    return performance.now() - start;
  };
  await selectTab(0);
  await page.locator("textarea:visible").last().focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("AUDIT_DIRTY_DRAFT");
  await page.waitForFunction(async (file) => {
    const result = await window.__TAURI_INTERNALS__.invoke("get_editor_lines", { path: file, startLine: 0, endLine: 10 });
    return result.lines.some((line) => line.text.includes("AUDIT_DIRTY_DRAFT"));
  }, tabs[0].path);
  const switchTimes = [];
  for (let index = 1; index < tabs.length; index++) {
    switchTimes.push(await selectTab(index));
    assert.ok(await page.locator("textarea").count() <= 12, "Hot editor views exceeded the ordinary cache budget");
    if (index % 25 === 0) console.log(`UI tab stress: ${index}/100 tabs switched`);
  }
  await selectTab(0);
  const draft = await check("dirty buffer survives hot view eviction", "get_editor_lines", { path: tabs[0].path, startLine: 0, endLine: 10 }, true);
  assert.ok(draft.lines.some((line) => line.text.includes("AUDIT_DIRTY_DRAFT")));
  assert.ok(!fs.readFileSync(tabs[0].path, "utf8").includes("AUDIT_DIRTY_DRAFT"));
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("heading", { name: "Audit Markdown", exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "markdown-desktop.png") });
  await selectTab(99);
  await page.locator("[role=tab][data-tab-id]").nth(0).evaluate((element) => element.click());
  await page.getByRole("heading", { name: "Audit Markdown", exact: true }).waitFor();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.locator("textarea:visible").last().focus();
  await page.keyboard.press("Control+s");
  for (let attempt = 0; attempt < 100 && !fs.readFileSync(tabs[0].path, "utf8").includes("AUDIT_DIRTY_DRAFT"); attempt++) await delay(50);
  assert.ok(fs.readFileSync(tabs[0].path, "utf8").includes("AUDIT_DIRTY_DRAFT"));
  switchTimes.sort((a, b) => a - b);
  records.push({ name: "100 real tabs: bounded views, dirty buffer, Markdown state and UI save", passed: true,
    tabs: 100, maxHotEditorViews: 12, p50Ms: switchTimes[49], p95Ms: switchTimes[94],
    inactiveCanvasFrameAcceptance: false, baselineComparison: false });
  assert.equal(errors.length, 0, `Uncaught WebView errors: ${errors.join("; ")}`);
  await page.screenshot({ path: path.join(output, "initial-desktop.png") });
  fs.writeFileSync(path.join(output, "initial-dom.txt"), await page.locator("body").innerText());
  report.pageErrors = errors;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = String(error);
  if (page) {
    await page.screenshot({ path: path.join(output, "failure-desktop.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(output, "failure-dom.txt"), await page.locator("body").innerText().catch(() => "DOM unavailable"));
  }
  throw error;
} finally {
  fs.writeFileSync(path.join(output, `desktop-report-${report.generatedAt.replaceAll(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, "desktop-report.json"), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => undefined);
  if (processHandle.exitCode === null) processHandle.kill();
}
console.log(`Isolated WebView2 audit: ${records.length} checks passed. Candidate/native approvals remain separate.`);
