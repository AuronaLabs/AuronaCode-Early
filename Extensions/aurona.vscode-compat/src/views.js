// Bounded tree/webview adapters. All state belongs to the active extension session.
(() => {
  const { Disposable, EventEmitter } = vscode;
  const trees = new Map();
  const panels = new Map();
  let panelSequence = 0;
  class TreeItem {
    constructor(label, collapsibleState = 0) { Object.assign(this, { label, collapsibleState }); }
  }
  class ThemeIcon { constructor(id) { this.id = id; } }
  Object.assign(vscode, { TreeItem, ThemeIcon, TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 } });
  vscode.window.createTreeView = (id, options) => {
    if (trees.has(id)) throw new Error('[compat.view_duplicate] ' + id);
    const selection = new EventEmitter();
    const expanded = new EventEmitter();
    const collapsed = new EventEmitter();
    const state = { id, provider: options.treeDataProvider, nodes: new Map(), open: new Set(), selection: [], selectionEvent: selection, expanded, collapsed };
    trees.set(id, state);
    const refresh = state.provider.onDidChangeTreeData?.(() => { state.dirty = true; });
    const view = { selection: [], visible: true, onDidChangeSelection: selection.event, onDidExpandElement: expanded.event, onDidCollapseElement: collapsed.event,
      reveal: () => Promise.reject(new Error('[compat.unsupported] TreeView.reveal')),
      dispose() { if (trees.get(id) !== state) return; trees.delete(id); refresh?.dispose(); selection.dispose(); expanded.dispose(); collapsed.dispose(); } };
    state.view = view;
    return view;
  };
  vscode.window.registerTreeDataProvider = (id, provider) => vscode.window.createTreeView(id, { treeDataProvider: provider });
  const createPanel = (viewType, title, options = {}) => {
    const id = 'panel-' + ++panelSequence;
    const received = new EventEmitter();
    const disposed = new EventEmitter();
    const changed = new EventEmitter();
    if (panels.size >= 8) throw new Error('[resource.limit] Maximum 8 webviews per extension');
    const state = { id, viewType, title, html: '', options, messages: [], revision: 0, sequence: 0 };
    const webview = { options, cspSource: 'data:',
      get html() { return state.html; }, set html(value) { state.html = String(value); state.revision++; },
      onDidReceiveMessage: received.event,
      postMessage(message) { const serialized = JSON.stringify(message); if (serialized === undefined || serialized.length > 65536) return Promise.reject(new Error('[resource.limit] Webview message must be JSON up to 64 KiB')); state.messages.push({ sequence: ++state.sequence, value: JSON.parse(serialized) }); if (state.messages.length > 64) state.messages.shift(); return Promise.resolve(panels.has(id)); },
      asWebviewUri() { throw new Error('[compat.unsupported] Packaged webview resources; embed data resources in this version'); } };
    const panel = { webview, viewType, active: true, visible: true, viewColumn: 1,
      get title() { return state.title; }, set title(value) { state.title = String(value); },
      onDidDispose: disposed.event, onDidChangeViewState: changed.event,
      reveal() { panel.visible = true; changed.fire({ webviewPanel: panel }); },
      dispose() { if (!panels.delete(id)) return; panel.visible = false; disposed.fire(); received.dispose(); disposed.dispose(); changed.dispose(); } };
    Object.assign(state, { panel, webview, received }); panels.set(id, state);
    return panel;
  };
  vscode.window.createWebviewPanel = (viewType, title, _column, options) => createPanel(viewType, title, options);
  vscode.window.registerWebviewViewProvider = (id, provider, options) => {
    const panel = createPanel(id, id, options?.webviewOptions);
    const cancellation = { isCancellationRequested: false, onCancellationRequested: () => new Disposable(() => {}) };
    provider.resolveWebviewView({ webview: panel.webview, visible: true, show: () => panel.reveal(), onDidDispose: panel.onDidDispose, onDidChangeVisibility: panel.onDidChangeViewState }, { state: undefined }, cancellation);
    return new Disposable(() => panel.dispose());
  };
  globalThis.__auronaHandleViewAction = async (action, data) => {
    if (action.startsWith('tree:')) {
      const [, id, key, kind] = action.split(':');
      const tree = trees.get(decodeURIComponent(id)); const node = tree?.nodes.get(key);
      if (!node) throw new Error('[compat.tree_stale] Tree node is no longer available');
      if (kind === 'toggle') {
        if (tree.open.delete(key)) tree.collapsed.fire({ element: node.element });
        else { tree.open.add(key); tree.expanded.fire({ element: node.element }); }
      } else {
        tree.view.selection = [node.element]; tree.selectionEvent.fire({ selection: tree.view.selection });
        if (node.item.command) await vscode.commands.executeCommand(node.item.command.command, ...(node.item.command.arguments || []));
      }
    } else if (action.startsWith('webview:')) {
      const panel = panels.get(action.slice(8));
      if (!panel) throw new Error('[compat.webview_stale] Webview is no longer available');
      panel.received.fire(data);
    } else throw new Error('[compat.unsupported] View action ' + action);
  };
  globalThis.__auronaViewsSnapshot = async () => {
    const components = [];
    for (const tree of trees.values()) {
      const nodes = new Map(); const rows = []; let count = 0;
      const walk = async (parent, prefix = '', depth = 0) => {
        if (depth > 16) throw new Error('[resource.limit] Tree depth exceeds 16');
        const children = await tree.provider.getChildren(parent) || [];
        for (let index = 0; index < children.length; index++) {
          if (++count > 500) throw new Error('[resource.limit] Tree exceeds 500 visible nodes');
          const element = children[index]; const item = await tree.provider.getTreeItem(element);
          const key = prefix + index; nodes.set(key, { element, item });
          const action = 'tree:' + encodeURIComponent(tree.id) + ':' + key + ':';
          if (item.collapsibleState === 2 && !tree.nodes.has(key)) tree.open.add(key);
          const buttons = [];
          if (item.collapsibleState) buttons.push({ type: 'button', id: action + 'toggle', label: tree.open.has(key) ? '▾' : '▸', variant: 'ghost', action: action + 'toggle' });
          buttons.push({ type: 'button', id: action + 'select', label: '  '.repeat(depth) + (typeof item.label === 'object' ? item.label.label : item.label || String(element)), variant: 'ghost', action: action + 'select' });
          rows.push({ type: 'container', direction: 'horizontal', children: buttons });
          if (item.collapsibleState && tree.open.has(key)) await walk(element, key + '.', depth + 1);
        }
      };
      await walk(undefined); tree.nodes = nodes;
      components.push({ type: 'card', title: tree.id, children: rows });
    }
    return { components, webviews: [...panels.values()].filter(state => state.panel.visible).map(state => ({ id: state.id, title: state.title, html: state.html, revision: state.revision, enableScripts: state.webview.options.enableScripts === true, messages: state.messages })) };
  };
  const dispose = __auronaDispose;
  globalThis.__auronaDispose = async () => { try { await dispose(); } finally { for (const tree of [...trees.values()]) tree.view.dispose(); for (const state of [...panels.values()]) state.panel.dispose(); } };
})();
