import type { EditorSelection } from "./EditorInteraction";
import { sortSelection } from "./EditorMath";

export interface EditorLineRange {
  startLine: number;
  endLine: number;
}

export function affectedLineRange(
  cursorLine: number,
  selection: EditorSelection | null,
): EditorLineRange {
  if (!selection) return { startLine: cursorLine, endLine: cursorLine };
  const { start, end } = sortSelection(selection);
  return {
    startLine: start.line,
    endLine: end.char === 0 && end.line > start.line ? end.line - 1 : end.line,
  };
}

export function indentLineRange(lines: string[], range: EditorLineRange, indent: string): string[] {
  return lines.map((line, index) =>
    index >= range.startLine && index <= range.endLine ? `${indent}${line}` : line,
  );
}

export function outdentLineRange(
  lines: string[],
  range: EditorLineRange,
  indentSize: number,
): { lines: string[]; removed: number[] } {
  const removed = Array.from({ length: lines.length }, () => 0);
  return {
    lines: lines.map((line, index) => {
      if (index < range.startLine || index > range.endLine) return line;
      const match = line.match(new RegExp(`^(?:\\t| {1,${Math.max(1, indentSize)}})`));
      removed[index] = match?.[0].length ?? 0;
      return line.slice(removed[index]);
    }),
    removed,
  };
}

export function toggleLineComment(
  lines: string[],
  range: EditorLineRange,
  marker: string,
): { lines: string[]; uncommented: boolean } {
  const target = lines.slice(range.startLine, range.endLine + 1);
  const nonEmpty = target.filter((line) => line.trim().length > 0);
  const uncommented =
    nonEmpty.length > 0 && nonEmpty.every((line) => line.trimStart().startsWith(marker));
  return {
    uncommented,
    lines: lines.map((line, index) => {
      if (index < range.startLine || index > range.endLine || line.trim().length === 0) return line;
      const indentation = line.length - line.trimStart().length;
      if (uncommented) {
        const markerIndex = line.indexOf(marker, indentation);
        const suffixStart = markerIndex + marker.length;
        const spacing = line[suffixStart] === " " ? 1 : 0;
        return line.slice(0, markerIndex) + line.slice(suffixStart + spacing);
      }
      return `${line.slice(0, indentation)}${marker} ${line.slice(indentation)}`;
    }),
  };
}

export function moveLineRange(
  lines: string[],
  range: EditorLineRange,
  direction: -1 | 1,
): { lines: string[]; range: EditorLineRange } {
  if (
    (direction === -1 && range.startLine === 0) ||
    (direction === 1 && range.endLine >= lines.length - 1)
  ) {
    return { lines, range };
  }
  const next = [...lines];
  const block = next.splice(range.startLine, range.endLine - range.startLine + 1);
  const insertAt = direction === -1 ? range.startLine - 1 : range.startLine + 1;
  next.splice(insertAt, 0, ...block);
  return {
    lines: next,
    range: { startLine: range.startLine + direction, endLine: range.endLine + direction },
  };
}

export function duplicateLineRange(
  lines: string[],
  range: EditorLineRange,
): { lines: string[]; range: EditorLineRange } {
  const next = [...lines];
  const block = next.slice(range.startLine, range.endLine + 1);
  next.splice(range.endLine + 1, 0, ...block);
  const size = block.length;
  return {
    lines: next,
    range: { startLine: range.startLine + size, endLine: range.endLine + size },
  };
}
