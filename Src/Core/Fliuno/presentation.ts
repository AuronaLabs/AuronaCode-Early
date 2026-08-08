import type { FliunoCoreResult, FliunoCoreResultKind } from "./FliunoCore";

export const SECTION_ORDER: FliunoCoreResultKind[] = [
  "command",
  "file",
  "setting",
  "symbol",
  "content",
];

export interface FliunoPresentation {
  display: FliunoCoreResult[];
  indexById: Map<string, number>;
  contentGroups: Array<{ path: string; items: FliunoCoreResult[] }>;
}

/**
 * 把 Core 返回的按 Score 排序结果，拍平为「可视顺序」。
 * 展示顺序 = 键盘导航顺序 = Enter 执行顺序，三者共用同一个数组。
 * 内容结果按文件分组（组内保持 Core 原始顺序）。
 */
export function flattenFliunoPresentation(results: FliunoCoreResult[]): FliunoPresentation {
  const display: FliunoCoreResult[] = [];
  const contentByFile = new Map<string, FliunoCoreResult[]>();
  for (const kind of SECTION_ORDER) {
    if (kind === "content") continue;
    for (const result of results) {
      if (result.kind !== kind) continue;
      display.push(result);
    }
  }
  for (const result of results) {
    if (result.kind !== "content" || !result.targetPath) continue;
    const list = contentByFile.get(result.targetPath) ?? [];
    list.push(result);
    contentByFile.set(result.targetPath, list);
  }
  for (const [, items] of contentByFile) {
    display.push(...items);
  }
  const indexById = new Map<string, number>();
  for (let index = 0; index < display.length; index += 1) {
    indexById.set(display[index]?.id ?? "", index);
  }
  return {
    display,
    indexById,
    contentGroups: [...contentByFile.entries()].map(([path, items]) => ({ path, items })),
  };
}
