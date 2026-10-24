import ts from "typescript";
import path from "node:path/posix";

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
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports;
}

export function analyzeModules(modules) {
  const names = new Set(modules.map(item => item.path));
  const graph = new Map(modules.map(item => [item.path, []]));
  const violations = [];
  for (const module of modules) {
    const sourceLayer = module.path.split('/')[0];
    for (const entry of importsOf(module.source, module.path)) {
      if (entry.target.startsWith('@tauri-apps/') && !module.path.startsWith('Foundation/Desktop/')) violations.push(`${module.path}: Tauri imports belong to Foundation/Desktop`);
      if (!entry.target.startsWith('.')) continue;
      const candidate = path.normalize(path.join(path.dirname(module.path), entry.target));
      const target = [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}/index.ts`, `${candidate}/index.tsx`].find(name => names.has(name));
      if (!target) continue;
      const targetLayer = target.split('/')[0];
      const prohibited = {
        Foundation: ['Core', 'Features', 'Layout', 'UI', 'State', 'App', 'Extension'],
        Core: ['Features', 'Layout', 'UI', 'App'],
        UI: ['Features', 'Layout', 'State', 'App', 'Core'],
      }[sourceLayer] ?? [];
      if (prohibited.includes(targetLayer)) violations.push(`${module.path} -> ${target}: reverse layer dependency`);
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
