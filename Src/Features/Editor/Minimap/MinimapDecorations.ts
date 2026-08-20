import type { DiagnosticItem } from "../Utils/EditorMath";

export interface MinimapDecoration {
  line: number;
  color: string;
  type: "error" | "warning" | "search" | "selection" | "git-add" | "git-mod" | "git-del";
}

export function collectMinimapDecorations(
  diagnostics: DiagnosticItem[],
  searchMatches: { line: number; char: number }[],
  selection: { start: { line: number }; end: { line: number } } | null,
  gitChanges?: { added: number[]; modified: number[]; deleted: number[] },
): MinimapDecoration[] {
  const decorations: MinimapDecoration[] = [];

  // 1. 诊断标记 (错误优先于警告)
  for (const diag of diagnostics) {
    const line = diag.range.start.line;
    decorations.push({
      line,
      color: diag.severity === 1 ? "var(--StatusError)" : "var(--StatusWarning)",
      type: diag.severity === 1 ? "error" : "warning",
    });
  }

  // 2. 搜索匹配标记
  for (const match of searchMatches) {
    decorations.push({
      line: match.line,
      color: "var(--EditorSearchMatchBg, #f59e0b)",
      type: "search",
    });
  }

  // 3. 选区范围标记
  if (selection) {
    const start = Math.min(selection.start.line, selection.end.line);
    const end = Math.max(selection.start.line, selection.end.line);
    for (let l = start; l <= end; l++) {
      decorations.push({
        line: l,
        color: "var(--color-accent)",
        type: "selection",
      });
    }
  }

  // 4. Git 差异标记
  if (gitChanges) {
    for (const l of gitChanges.added) {
      decorations.push({ line: l, color: "var(--GitAdded, #22c55e)", type: "git-add" });
    }
    for (const l of gitChanges.modified) {
      decorations.push({ line: l, color: "var(--GitModified, #3b82f6)", type: "git-mod" });
    }
    for (const l of gitChanges.deleted) {
      decorations.push({ line: l, color: "var(--GitDeleted, #ef4444)", type: "git-del" });
    }
  }

  return decorations;
}
