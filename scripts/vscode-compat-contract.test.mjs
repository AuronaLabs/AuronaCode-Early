import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const shim = readFileSync(new URL('../Extensions/aurona.vscode-compat/src/shim.js', import.meta.url), 'utf8');
const views = readFileSync(new URL('../Extensions/aurona.vscode-compat/src/views.js', import.meta.url), 'utf8');
function sandbox(metadata = {}) {
  const storage = new Map();
  const context = vm.createContext({
    vscode: { commands: {}, workspace: { fs: { readFile: () => Promise.resolve('你好🌙') } }, window: { showInformationMessage() {}, showWarningMessage() {}, showErrorMessage() {}, setStatusBarMessage() {} }, env: { clipboard: { readText() { throw new Error('clipboard denied'); }, writeText() { throw new Error('clipboard denied'); } } } },
    __auronaMetadata: { extensionPath: '/extensions/demo', workspaceId: 'workspace-a', workspacePath: '/work', platform: 'linux', ...metadata },
    __auronaWriteFile: (_path, content) => { context.written = content; },
    raw: { get: key => storage.get(key), set: (key, value) => { storage.set(key, value); }, delete: key => storage.delete(key), keys: () => [...storage.keys()] },
  });
  vm.runInContext(shim, context);
  vm.runInContext(views, context);
  vm.runInContext('globalThis.ctx = __auronaCreateContext(raw);', context);
  return { context, run: source => vm.runInContext(source, context), storage };
}

test('commands preserve arguments/results, reject errors and dispose exactly once', async () => {
  const { run } = sandbox();
  run("globalThis.disposable = vscode.commands.registerCommand('sum', (a,b) => a+b);");
  assert.equal(await run("vscode.commands.executeCommand('sum', 20, 22)"), 42);
  run('disposable.dispose(); disposable.dispose();');
  await assert.rejects(run("vscode.commands.executeCommand('sum')"), /compat.command_unavailable/);
  run("vscode.commands.registerCommand('fail', async () => { throw new Error('visible failure'); });");
  await assert.rejects(run("vscode.commands.executeCommand('fail')"), /visible failure/);
});

test('CommonJS loads relative modules, JSON and packaged dependencies once, with isolated scopes', () => {
  const { context, run } = sandbox();
  context.__auronaModuleSources = {
    'extension/main.js': "const dep = require('./lib'); module.exports = [dep.value, require('demo').value, require('./data.json').text];",
    'extension/lib/index.js': "const vscode = require('vscode'); globalThis.loaded = (globalThis.loaded||0)+1; exports.value = loaded;",
    'extension/data.json': '{"text":"中文"}',
    'extension/node_modules/demo/package.json': '{"main":"entry.js"}',
    'extension/node_modules/demo/entry.js': 'module.exports = { value: 42 };',
  };
  assert.deepEqual(Array.from(run("__auronaLoadModule('extension/main.js')")), [1, 42, '中文']);
  run("__auronaLoadModule('extension/main.js')"); assert.equal(context.loaded, 1);
  assert.throws(() => run("require('node:fs')"), /compat.unsupported/);
  assert.throws(() => run("require('../../escape')"), /compat.module_boundary/);
});

test('Memento stores structured JSON, defaults and deletion with workspace isolation', async () => {
  const { context, run } = sandbox();
  await run("ctx.globalState.update('object', { count: 2, values: ['a', true] })");
  assert.equal(run("ctx.globalState.get('object').count"), 2);
  assert.equal(run("ctx.workspaceState.get('object', 'missing')"), 'missing');
  await run("ctx.workspaceState.update('object', { count: 9 })");
  context.__auronaMetadata.workspaceId = 'workspace-b';
  run('globalThis.other = __auronaCreateContext(raw);');
  assert.equal(run("other.workspaceState.get('object', 'missing')"), 'missing');
  assert.equal(run("other.globalState.get('object').count"), 2);
  await run("other.globalState.update('object', undefined)");
  assert.equal(run("other.globalState.keys().length"), 0);
});

test('URI and fs contracts preserve unicode/UTF-8 and reject paths outside the workspace', async () => {
  const { run, context } = sandbox();
  assert.equal(run("vscode.Uri.parse(vscode.Uri.file('/work/你好 #.md').toString()).fsPath"), '/work/你好 #.md');
  const bytes = await run("vscode.workspace.fs.readFile(vscode.Uri.file('/work/file.md'))");
  assert.deepEqual(Array.from(bytes), Array.from(new TextEncoder().encode('你好🌙')));
  await run("vscode.workspace.fs.writeFile(vscode.Uri.file('/work/file.md'), new TextEncoder().encode('你好🌙'))");
  assert.equal(context.written, '你好🌙');
  await assert.rejects(run("vscode.workspace.fs.readFile(vscode.Uri.file('/outside/file'))"), /workspace.boundary/);
  const windows = sandbox({ workspacePath: 'C:\\work', platform: 'windows' });
  assert.equal(windows.run("vscode.Uri.parse('file:///C:/work/a%20b.txt').fsPath"), 'C:\\work\\a b.txt');
  windows.context.unc = String.raw`\\server\share\file`;
  assert.equal(windows.run("vscode.Uri.file(unc).toString()"), 'file://server/share/file');
});

test('document changes deliver snapshots and disposed listeners stop receiving events', () => {
  const { run } = sandbox();
  run("globalThis.events = []; globalThis.listener = vscode.workspace.onDidChangeTextDocument(event => events.push(event));");
  run("__auronaSyncDocument({ path:'/work/test.ts', content:'old', version:1, language:'typescript' });");
  run("__auronaSyncDocument({ path:'/work/test.ts', content:'你好\\nworld', version:2, language:'typescript' });");
  assert.equal(run('events.length'), 1);
  assert.equal(run('events[0].document.lineAt(1).text'), 'world');
  assert.equal(run('events[0].contentChanges[0].rangeLength'), 3);
  run("listener.dispose(); __auronaSyncDocument({ path:'/work/test.ts', content:'next', version:3 });");
  assert.equal(run('events.length'), 1);
});

test('clipboard denial rejects and deactivation disposes subscriptions', async () => {
  const { run } = sandbox();
  await assert.rejects(run('vscode.env.clipboard.readText()'), /clipboard denied/);
  await assert.rejects(run("vscode.env.clipboard.writeText('a')"), /clipboard denied/);
  run("globalThis.disposed = 0; ctx.subscriptions.push(new vscode.Disposable(() => { disposed++; })); module.exports.deactivate = () => { disposed++; };");
  await run('__auronaDispose()'); assert.equal(run('disposed'), 2);
});

test('tree providers render async children, execute node commands and dispose views', async () => {
  const { run } = sandbox();
  run(`globalThis.selected = 0; const change = new vscode.EventEmitter();
    vscode.commands.registerCommand('tree.select', value => { selected = value; });
    globalThis.tree = vscode.window.createTreeView('demo.tree', { treeDataProvider: {
      onDidChangeTreeData: change.event,
      getChildren: async parent => parent ? ['child'] : ['root'],
      getTreeItem: element => ({ label: element, collapsibleState: element === 'root' ? 1 : 0, command: element === 'child' ? { command:'tree.select', arguments:[42] } : undefined })
    }}); ctx.subscriptions.push(tree);`);
  const first = await run('__auronaViewsSnapshot()');
  assert.equal(first.components[0].children.length, 1);
  run("change.fire();");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run("typeof __auronaViewSnapshot"), 'string');
  await run("__auronaHandleViewAction('tree:demo.tree:0:toggle', null)");
  assert.equal((await run('__auronaViewsSnapshot()')).components[0].children.length, 2);
  await run("__auronaHandleViewAction('tree:demo.tree:0.0:select', null)");
  assert.equal(run('selected'), 42);
  assert.equal(run('tree.selection[0]'), 'child');
  await run('__auronaDispose()');
  assert.equal((await run('__auronaViewsSnapshot()')).components.length, 0);
});

test('webview messages, title, disposal and capability boundaries are observable', async () => {
  const { run } = sandbox();
  run(`globalThis.panel = vscode.window.createWebviewPanel('demo','Demo',1,{enableScripts:true});
    panel.webview.html = '<h1>你好</h1>'; globalThis.received = [];
    ctx.subscriptions.push(panel, panel.webview.onDidReceiveMessage(value => received.push(value)));
    globalThis.disposed = false; panel.onDidDispose(() => { disposed = true; });`);
  await run("panel.webview.postMessage({ hello:'world' })");
  const snapshot = await run('__auronaViewsSnapshot()');
  assert.equal(snapshot.webviews[0].html, '<h1>你好</h1>');
  assert.equal(snapshot.webviews[0].messages[0].sequence, 1);
  await run("__auronaHandleViewAction('webview:panel-1', { count:2 })");
  assert.equal(run('received[0].count'), 2);
  assert.throws(() => run("panel.webview.asWebviewUri(vscode.Uri.file('/work/a'))"), /compat.unsupported/);
  await run('__auronaDispose()'); assert.equal(run('disposed'), true);
  assert.equal((await run('__auronaViewsSnapshot()')).webviews.length, 0);
});
