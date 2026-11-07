import assert from "node:assert/strict";
import test from "node:test";
import { analyzeModules } from "./lib/source-boundaries.mjs";
import { checkRustDomainBoundaries } from "./lib/rust-domain-boundaries.mjs";
test('AST boundaries include multiline imports, re-exports, lazy imports and runtime cycles', () => {
  const result = analyzeModules([
    { path: 'Core/A.ts', source: "export { B } from './B';\nimport {\n C\n} from '../UI/C';" },
    { path: 'Core/B.ts', source: "const next = import('./A'); export const B=1;" },
    { path: 'UI/C.ts', source: 'export const C=1;' },
  ]);
  assert.deepEqual(result.cycles, [['Core/A.ts', 'Core/B.ts']]);
  assert.equal(result.violations.length, 1);
});
test('explicit type-only imports do not create runtime cycles but still respect layer boundaries', () => {
  const result = analyzeModules([
    { path: 'Core/A.ts', source: "import { type B } from './B'; import type { C } from '../UI/C';" },
    { path: 'Core/B.ts', source: "import { A } from './A';" },
    { path: 'UI/C.ts', source: '' },
  ]);
  assert.deepEqual(result.cycles, []); assert.equal(result.violations.length, 1);
});

test('Core state imports and cross-feature composition are rejected', () => {
  const result = analyzeModules([
    { path: 'Core/A.ts', source: "import type { S } from '../State/S'" },
    { path: 'State/S.ts', source: 'export type S = string' },
    { path: 'Features/A/View.ts', source: "export { View } from '../B/View'" },
    { path: 'Features/B/View.ts', source: 'export const View = 1' },
  ]);
  assert.equal(result.violations.length, 2);
});

test('inline import types obey boundaries without creating runtime edges', () => {
  const result = analyzeModules([
    { path: 'Core/A.ts', source: "type State = import('../State/S').State;" },
    { path: 'State/S.ts', source: "export type State = import('../Core/A').A;" },
  ]);
  assert.equal(result.violations.length, 1);
  assert.equal(result.edges, 0);
  assert.deepEqual(result.cycles, []);
});

test('TypeScript aliases and private domain imports cannot bypass boundaries', () => {
  const root = process.cwd().replaceAll('\\', '/') + '/virtual-src';
  const result = analyzeModules([
    { path: 'Features/A/View.ts', source: "export { value } from '@core/Git/internal'" },
    { path: 'Core/Git/index.ts', source: "export { value } from './internal'" },
    { path: 'Core/Git/internal.ts', source: 'export const value = 1' },
  ], {
    root,
    compilerOptions: { baseUrl: root, paths: { '@core/*': ['Core/*'] } },
    domains: [{ root: 'Core/Git', public: ['Core/Git/index.ts'] }],
  });
  assert.equal(result.edges, 2);
  assert.match(result.violations[0], /private domain implementation/);
});

test('migrated Rust domains use domain capabilities and isolate command adapters', () => {
  assert.deepEqual(checkRustDomainBoundaries([
    { path: 'workspace/mod.rs', source: 'use crate::git::GitState;' },
    { path: 'editor/ipc.rs', source: '#[tauri::command] pub fn open() {}' },
    { path: 'git/mod.rs', source: 'use crate::workspace::WorkspaceState;' },
  ]), []);
  const errors = checkRustDomainBoundaries([
    { path: 'workspace/filesystem/mod.rs', source: 'use crate::commands::git::GitState;' },
    { path: 'editor/mod.rs', source: '#[tauri::command] pub fn open() {}' },
    { path: 'extensions/runtime/host.rs', source: 'crate::commands::fs::read_file();' },
  ]);
  assert.equal(errors.length, 3);
});
