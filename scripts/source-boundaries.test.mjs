import assert from "node:assert/strict";
import test from "node:test";
import { analyzeModules } from "./lib/source-boundaries.mjs";
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
