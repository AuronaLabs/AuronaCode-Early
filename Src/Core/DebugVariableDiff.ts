import type { DebugScope, DebugVariable } from "../State/useDebugStore";

export function collectVariableValues(
  scopes: readonly DebugScope[],
  variablesByReference: Record<number, DebugVariable[]>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const scope of scopes) {
    for (const variable of variablesByReference[scope.variablesReference] ?? []) {
      const key = `${scope.name}.${variable.evaluateName ?? variable.name}`;
      values[key] = variable.value;
    }
  }
  return values;
}

/** 返回与上一轮暂停相比「新增或值变化」的变量 key。 */
export function diffVariableValues(
  previous: Record<string, string>,
  current: Record<string, string>,
): string[] {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(current)) {
    if (previous[key] !== value) changed.push(key);
  }
  return changed;
}
