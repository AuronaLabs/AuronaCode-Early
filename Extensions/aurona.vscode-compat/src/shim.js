// Deliberately bounded VS Code surface. Missing capabilities fail explicitly.
globalThis.__auronaLogs = [];
globalThis.console = Object.fromEntries(['log', 'info', 'warn', 'error'].map(level =>
  [level, (...args) => { __auronaLogs.push(`[${level}] ${args.map(String).join(' ')}`); if (__auronaLogs.length > 200) __auronaLogs.shift(); }]));
globalThis.module = { exports: {} };
globalThis.exports = module.exports;

(() => {
  const unsupported = name => { throw new Error(`[compat.unsupported] ${name} is unavailable in this sandbox`); };
  class Disposable {
    constructor(call) { this.call = call; this.disposed = false; }
    dispose() { if (!this.disposed) { this.disposed = true; this.call?.(); } }
    static from(...items) { return new Disposable(() => items.forEach(item => item?.dispose())); }
  }
  class EventEmitter {
    constructor() {
      this.listeners = new Set();
      this.event = (listener, thisArg, disposables) => {
        const bound = thisArg ? listener.bind(thisArg) : listener;
        this.listeners.add(bound);
        const item = new Disposable(() => this.listeners.delete(bound));
        disposables?.push(item);
        return item;
      };
    }
    fire(value) { for (const listener of [...this.listeners]) { try { listener(value); } catch (error) { console.error(error); } } }
    dispose() { this.listeners.clear(); }
  }
  class Uri {
    constructor(scheme, authority, path, query = '', fragment = '') { Object.assign(this, { scheme, authority, path, query, fragment }); }
    static file(path) {
      path = String(path).replace(/\\/g, '/');
      if (/^[A-Za-z]:/.test(path)) path = '/' + path;
      if (path.startsWith('//')) { const end = path.indexOf('/', 2); return new Uri('file', end < 0 ? path.slice(2) : path.slice(2, end), end < 0 ? '/' : path.slice(end)); }
      return new Uri('file', '', path.startsWith('/') ? path : '/' + path);
    }
    static parse(value) {
      const match = /^([a-z][\w+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(value);
      if (!match) throw new TypeError('[compat.uri] Invalid URI: ' + value);
      return new Uri(match[1], match[2] || '', decodeURIComponent(match[3]), match[4] || '', match[5] || '');
    }
    static joinPath(base, ...parts) { const segments = (base.path + '/' + parts.join('/')).split('/'); const result = []; for (const part of segments) { if (part === '..') result.pop(); else if (part && part !== '.') result.push(part); } return base.with({ path: '/' + result.join('/') }); }
    get fsPath() { const path = this.authority ? '//' + this.authority + this.path : this.path; return __auronaMetadata.platform === 'windows' && this.scheme === 'file' ? path.replace(/^\/([a-z]:)/i, '$1').replace(/\//g, '\\') : path; }
    with(change) { return new Uri(change.scheme ?? this.scheme, change.authority ?? this.authority, change.path ?? this.path, change.query ?? this.query, change.fragment ?? this.fragment); }
    toString() { return this.scheme + ':' + (this.scheme === 'file' || this.authority ? '//' + this.authority : '') + this.path.split('/').map(encodeURIComponent).join('/').replace(/%3A/gi, ':') + (this.query ? '?' + this.query : '') + (this.fragment ? '#' + this.fragment : ''); }
    toJSON() { return { scheme: this.scheme, authority: this.authority, path: this.path, query: this.query, fragment: this.fragment }; }
  }
  class Position { constructor(line, character) { this.line = line; this.character = character; } isEqual(other) { return this.line === other.line && this.character === other.character; } }
  class Range { constructor(a, b, c, d) { this.start = typeof a === 'number' ? new Position(a, b) : a; this.end = typeof a === 'number' ? new Position(c, d) : b; } get isEmpty() { return this.start.isEqual(this.end); } }
  class TextEncoder {
    encode(text = '') { const bytes = []; for (const char of String(text)) { let code = char.codePointAt(0); if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd; if (code < 0x80) bytes.push(code); else if (code < 0x800) bytes.push(0xc0 | code >> 6, 0x80 | code & 63); else if (code < 0x10000) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63); else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63); } return new Uint8Array(bytes); }
  }
  class TextDecoder {
    decode(bytes = []) { return decodeURIComponent(Array.from(bytes, byte => '%' + byte.toString(16).padStart(2, '0')).join('')); }
  }
  globalThis.TextEncoder ??= TextEncoder;
  globalThis.TextDecoder ??= TextDecoder;
  Object.assign(vscode, { Disposable, EventEmitter, Uri, Position, Range, StatusBarAlignment: { Left: 1, Right: 2 }, ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 } });
  const native = { readFile: vscode.workspace.fs.readFile, clipboard: { ...vscode.env.clipboard }, message: {}, status: vscode.window.setStatusBarMessage };
  const commands = new Map();
  vscode.commands.__registry = [];
  vscode.commands.registerCommand = (id, handler, thisArg) => {
    if (typeof id !== 'string' || !id || typeof handler !== 'function') throw new TypeError('registerCommand requires an id and a function');
    if (commands.has(id)) throw new Error(`[compat.command_duplicate] ${id}`);
    const bound = handler.bind(thisArg);
    commands.set(id, bound);
    vscode.commands.__registry.push([id, bound]);
    return new Disposable(() => { if (commands.get(id) === bound) { commands.delete(id); vscode.commands.__registry = vscode.commands.__registry.filter(entry => entry[0] !== id); } });
  };
  vscode.commands.getCommands = () => Promise.resolve([...commands.keys()]);
  vscode.commands.executeCommand = (id, ...args) => Promise.resolve().then(() => {
    if (!commands.has(id)) throw new Error(`[compat.command_unavailable] ${id}`);
    return commands.get(id)(...args);
  });
  for (const name of ['showInformationMessage', 'showWarningMessage', 'showErrorMessage']) {
    native.message[name] = vscode.window[name];
    vscode.window[name] = (message, ...items) => {
      if (items.length) return Promise.reject(new Error('[compat.unsupported] Message choices are unavailable; use showQuickPick'));
      return Promise.resolve().then(() => { native.message[name](message); return undefined; });
    };
  }
  let statusRevision = 0;
  vscode.window.setStatusBarMessage = (text, timeout = 0) => {
    const revision = ++statusRevision;
    native.status(text, typeof timeout === 'number' ? timeout : 0);
    const disposable = new Disposable(() => { if (revision === statusRevision) native.status('', 0); });
    if (timeout && typeof timeout.then === 'function') Promise.resolve(timeout).then(() => disposable.dispose(), () => disposable.dispose());
    return disposable;
  };
  vscode.env.clipboard.readText = () => Promise.resolve().then(() => native.clipboard.readText());
  vscode.env.clipboard.writeText = text => Promise.resolve().then(() => native.clipboard.writeText(String(text)));
  const filePath = uri => {
    if (!(uri instanceof Uri) || uri.scheme !== 'file') throw new Error('[compat.uri] A file URI is required');
    const root = __auronaMetadata.workspacePath;
    if (!root) throw new Error('[permission.required:workspace.read] Workspace access requires approval');
    let path = uri.fsPath.replace(/\\/g, '/'); const base = root.replace(/\\/g, '/').replace(/\/$/, '');
    const fold = value => __auronaMetadata.platform === 'windows' ? value.toLowerCase() : value;
    if (!fold(path).startsWith(fold(base) + '/')) throw new Error('[workspace.boundary] URI is outside the workspace');
    return path.slice(base.length + 1);
  };
  vscode.workspace.fs.readFile = uri => Promise.resolve().then(() => native.readFile({ fsPath: filePath(uri) })).then(text => new TextEncoder().encode(text));
  vscode.workspace.fs.writeFile = (uri, bytes) => Promise.resolve().then(() => __auronaWriteFile(filePath(uri), new TextDecoder().decode(bytes)));
  const documentChanges = new EventEmitter();
  const configurationChanges = new EventEmitter();
  vscode.workspace.onDidChangeTextDocument = documentChanges.event;
  vscode.workspace.onDidChangeConfiguration = configurationChanges.event;
  vscode.workspace.workspaceFolders = __auronaMetadata.workspacePath ? [{ uri: Uri.file(__auronaMetadata.workspacePath), name: __auronaMetadata.workspacePath.split(/[\\/]/).pop(), index: 0 }] : undefined;
  vscode.workspace.textDocuments = [];
  globalThis.__auronaSyncDocument = snapshot => {
    if (!snapshot?.path || snapshot.content == null) return;
    const previous = vscode.workspace.textDocuments[0];
    const text = snapshot.content;
    const document = { uri: Uri.file(snapshot.path), fileName: snapshot.path, version: snapshot.version, languageId: snapshot.language || 'plaintext', isClosed: false, isUntitled: false, isDirty: false,
      getText: range => range ? text.slice(document.offsetAt(range.start), document.offsetAt(range.end)) : text,
      get lineCount() { return text.split('\n').length; },
      positionAt: offset => { const lines = text.slice(0, Math.max(0, Math.min(offset, text.length))).split('\n'); return new Position(lines.length - 1, lines.at(-1).length); },
      offsetAt: position => { const lines = text.split('\n'); const line = Math.max(0, Math.min(position.line, lines.length - 1)); return lines.slice(0, line).reduce((n, value) => n + value.length + 1, 0) + Math.max(0, Math.min(position.character, lines[line].replace(/\r$/, '').length)); },
      lineAt: index => { const line = typeof index === 'number' ? index : index.line; const value = text.split('\n')[line]; if (value === undefined) throw new RangeError('Invalid document line'); return { lineNumber: line, text: value.replace(/\r$/, ''), range: new Range(line, 0, line, value.replace(/\r$/, '').length), isEmptyOrWhitespace: !value.trim() }; } };
    vscode.workspace.textDocuments = [document];
    vscode.window.activeTextEditor = { document };
    if (previous?.uri.toString() === document.uri.toString() && previous.version !== document.version) documentChanges.fire({ document, contentChanges: [{ range: new Range(new Position(0, 0), previous.positionAt(previous.getText().length)), rangeOffset: 0, rangeLength: previous.getText().length, text }] });
  };
  const encodeKey = key => Array.from(new TextEncoder().encode(String(key)), byte => byte.toString(16).padStart(2, '0')).join('');
  globalThis.__auronaCreateContext = raw => {
    const state = prefix => ({
      keys: () => raw.keys().filter(key => key.startsWith(prefix)).map(key => new TextDecoder().decode(Uint8Array.from(key.slice(prefix.length).match(/../g) || [], value => parseInt(value, 16)))),
      get: (key, fallback) => { const value = raw.get(prefix + encodeKey(key)); return value === undefined ? fallback : JSON.parse(value); },
      update: (key, value) => Promise.resolve().then(() => value === undefined ? raw.delete(prefix + encodeKey(key)) : raw.set(prefix + encodeKey(key), JSON.stringify(value))),
      setKeysForSync: () => unsupported('Memento.setKeysForSync'),
    });
    const globalState = state('g-');
    const workspaceState = state('w-' + __auronaMetadata.workspaceId.slice(0, 24) + '-');
    vscode.workspace.getConfiguration = (section = '') => {
      const prefix = section ? section + '.' : '';
      return { get: (key, fallback) => globalState.get('config:' + prefix + key, fallback), has: key => globalState.get('config:' + prefix + key) !== undefined,
        update: (key, value) => globalState.update('config:' + prefix + key, value).then(() => configurationChanges.fire({ affectsConfiguration: other => other === section || (prefix + key).startsWith(other + '.') || other === prefix + key })) };
    };
    const result = { subscriptions: [], extensionPath: __auronaMetadata.extensionPath, extensionUri: Uri.file(__auronaMetadata.extensionPath), globalState, workspaceState,
      asAbsolutePath: relative => Uri.joinPath(Uri.file(__auronaMetadata.extensionPath), relative).fsPath };
    globalThis.__auronaActivationContext = result;
    return result;
  };
  const moduleCache = new Map();
  const normalize = path => { const result = []; for (const part of path.split('/')) { if (!part || part === '.') continue; if (part === '..') { if (!result.length) throw new Error('[compat.module_boundary] Module path escapes extension'); result.pop(); } else result.push(part); } return result.join('/'); };
  globalThis.__auronaLoadModule = (name, parent = 'extension/__entry.js') => {
    if (name === 'vscode') return vscode;
    const sources = globalThis.__auronaModuleSources || {};
    const roots = [];
    const directory = parent.slice(0, parent.lastIndexOf('/'));
    if (name.startsWith('.')) roots.push(normalize(directory + '/' + name));
    else if (name.startsWith('extension/')) roots.push(normalize(name));
    else if (/^(node:|fs$|path$|child_process$|os$|net$|http$|https$)/.test(name)) unsupported('Node module ' + name);
    else { let base = directory; while (base) { roots.push(base + '/node_modules/' + name); const slash = base.lastIndexOf('/'); base = slash < 0 ? '' : base.slice(0, slash); } }
    let id;
    for (const root of roots) {
      const candidates = [root, root + '.js', root + '.json', root + '/index.js', root + '/index.json'];
      if (sources[root + '/package.json']) { const main = JSON.parse(sources[root + '/package.json']).main; if (main) { const target = normalize(root + '/' + main); candidates.unshift(target, target + '.js', target + '/index.js'); } }
      id = candidates.find(path => Object.hasOwn(sources, path)); if (id) break;
    }
    if (!id) throw new Error(`[compat.module_unavailable] ${name} (from ${parent})`);
    if (moduleCache.has(id)) return moduleCache.get(id).exports;
    const target = { exports: {} }; moduleCache.set(id, target);
    try {
      if (id.endsWith('.json')) target.exports = JSON.parse(sources[id]);
      else new Function('module', 'exports', 'require', '__filename', '__dirname', sources[id])(target, target.exports, child => __auronaLoadModule(child, id), id, id.slice(0, id.lastIndexOf('/')));
      return target.exports;
    } catch (error) { moduleCache.delete(id); throw error; }
  };
  globalThis.require = name => __auronaLoadModule(name);
  globalThis.__auronaDispose = async () => {
    try { await module.exports.deactivate?.(); }
    finally { for (const disposable of (__auronaActivationContext?.subscriptions || []).splice(0).reverse()) { try { disposable?.dispose(); } catch (error) { console.error(error); } } documentChanges.dispose(); configurationChanges.dispose(); commands.clear(); moduleCache.clear(); native.status('', 0); }
  };
})();
