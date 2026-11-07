import ts from "typescript";
import nodePath from "node:path";

export function importsOf(source, name) {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings ?? node.exportClause;
      const typeOnly = node.isTypeOnly || clause?.isTypeOnly ||
        (!clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly)) ||
        (bindings && ts.isNamedExports(bindings) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly));
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push({ target: node.moduleSpecifier.text, runtime: !typeOnly });
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      imports.push({ target: node.arguments[0].text, runtime: true });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      imports.push({ target: node.moduleReference.expression.text, runtime: !node.isTypeOnly });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      imports.push({ target: node.argument.literal.text, runtime: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports;
}

export function analyzeModules(modules, options = {}) {
  const names = new Set(modules.map(item => item.path));
  const root = nodePath.resolve(options.root ?? "Src");
  const absoluteNames = new Map([...names].map(name => [nodePath.resolve(root, name), name]));
  const directories = new Set();
  for (const absolute of absoluteNames.keys()) {
    let directory = nodePath.dirname(absolute);
    while (!directories.has(directory)) {
      directories.add(directory);
      const parent = nodePath.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  const host = {
    ...ts.sys,
    fileExists: file => absoluteNames.has(nodePath.resolve(file)) || ts.sys.fileExists(file),
    directoryExists: dir => directories.has(nodePath.resolve(dir)) || ts.sys.directoryExists(dir),
  };
  const compilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, ...options.compilerOptions };
  const resolve = (from, specifier) => {
    const result = ts.resolveModuleName(specifier, nodePath.resolve(root, from), compilerOptions, host).resolvedModule;
    return result && absoluteNames.get(nodePath.resolve(result.resolvedFileName));
  };
  const domains = options.domains ?? [];
  const graph = new Map(modules.map(item => [item.path, []]));
  const violations = [];
  for (const module of modules) {
    const sourceLayer = module.path.split('/')[0];
    for (const entry of importsOf(module.source, module.path)) {
      if (entry.target.startsWith('@tauri-apps/') && !module.path.startsWith('Foundation/Desktop/')) violations.push(`${module.path}: Tauri imports belong to Foundation/Desktop`);
      const target = resolve(module.path, entry.target);
      if (!target) continue;
      const targetLayer = target.split('/')[0];
      const prohibited = {
        Foundation: ['Core', 'Features', 'Layout', 'UI', 'State', 'App', 'Extension'],
        Core: ['Features', 'Layout', 'UI', 'App', 'State'],
        UI: ['Features', 'Layout', 'State', 'App', 'Core'],
      }[sourceLayer] ?? [];
      if (prohibited.includes(targetLayer)) violations.push(`${module.path} -> ${target}: reverse layer dependency`);
      if (sourceLayer === 'Features' && targetLayer === 'Features' && module.path.split('/')[1] !== target.split('/')[1]) {
        violations.push(`${module.path} -> ${target}: cross-feature composition belongs to App/Layout`);
      }
      for (const domain of domains) {
        if (target.startsWith(`${domain.root}/`) && !module.path.startsWith(`${domain.root}/`) && !domain.public.includes(target)) {
          violations.push(`${module.path} -> ${target}: private domain implementation`);
        }
      }
      if (entry.runtime) graph.get(module.path).push(target);
    }
    if (!/^(Foundation\/(Desktop|IPC)\/)/.test(module.path) && /\b(?:invokeDesktop|listenDesktop)\b/.test(module.source)) violations.push(`${module.path}: desktop transport belongs to Foundation IPC`);
  }
  // Tarjan SCC detects complete runtime cycles, including barrel exports and lazy imports.
  let sequence = 0;
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), cycles = [];
  function visit(name) {
    indices.set(name, sequence); low.set(name, sequence++); stack.push(name); active.add(name);
    for (const next of graph.get(name)) {
      if (!indices.has(next)) { visit(next); low.set(name, Math.min(low.get(name), low.get(next))); }
      else if (active.has(next)) low.set(name, Math.min(low.get(name), indices.get(next)));
    }
    if (low.get(name) === indices.get(name)) {
      const members = []; let next;
      do { next = stack.pop(); active.delete(next); members.push(next); } while (next !== name);
      if (members.length > 1 || graph.get(name).includes(name)) cycles.push(members.sort());
    }
  }
  for (const name of [...names].sort()) if (!indices.has(name)) visit(name);
  return { violations, cycles, modules: graph.size, edges: [...graph.values()].reduce((sum, edges) => sum + edges.length, 0) };
}
