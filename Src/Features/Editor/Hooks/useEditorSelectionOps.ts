import { useCallback } from "react";
import { DocumentService } from "../../../Core/DocumentService";
import { sortSelection } from "../Utils/EditorMath";

export interface SelectionRange {
  start: { line: number; char: number };
  end: { line: number; char: number };
}

export function getLineStartUtf16(lines: string[], lineIndex: number): number {
  let offset = 0;
  for (let index = 0; index < lineIndex; index++) {
    offset += lines[index].length + 1;
  }
  return offset;
}

export function getCursorFromUtf16Offset(lines: string[], offset: number) {
  let remaining = Math.max(0, offset);
  for (let line = 0; line < lines.length; line++) {
    if (remaining <= lines[line].length) return { line, char: remaining };
    remaining -= lines[line].length + 1;
  }
  const lastLine = Math.max(0, lines.length - 1);
  return { line: lastLine, char: lines[lastLine]?.length ?? 0 };
}

export function getLinesAfterDeletion(lines: string[], sel: SelectionRange) {
  const { start, end } = sortSelection(sel);
  const startLineText = lines[start.line] || "";
  const endLineText = lines[end.line] || "";
  const newStartLineText = startLineText.substring(0, start.char) + endLineText.substring(end.char);

  const newLines = [...lines];
  newLines.splice(start.line, end.line - start.line + 1, newStartLineText);
  return {
    lines: newLines,
    cursor: start,
  };
}

export function useEditorSelectionOps({
  documentLines,
  selection,
  cursor,
  path,
  setDocumentLines,
  setCursor,
  setSelection,
  updateMaxLineLength,
  setTotalLines,
  onChange,
  onEditCommitted,
}: {
  documentLines: string[];
  selection: SelectionRange | null;
  cursor: { line: number; char: number };
  path?: string;
  setDocumentLines: (lines: string[]) => void;
  setCursor: (cursor: { line: number; char: number }) => void;
  setSelection: React.Dispatch<React.SetStateAction<SelectionRange | null>>;
  updateMaxLineLength: (lines: string[]) => void;
  setTotalLines: (total: number) => void;
  onChange?: (value: string) => void;
  /** 每次选区删除提交后回调（内容 + 光标 utf16 偏移），供撤销栈入栈 */
  onEditCommitted?: (content: string, cursorUtf16: number) => void;
}) {
  const executeSelectionDelete = useCallback(() => {
    if (!selection) return;
    const lines = [...documentLines];
    const { start, end } = sortSelection(selection);
    const startUtf16 = getLineStartUtf16(documentLines, start.line) + start.char;
    const endUtf16 = getLineStartUtf16(documentLines, end.line) + end.char;

    const deletion = getLinesAfterDeletion(lines, selection);
    setDocumentLines(deletion.lines);
    setCursor(deletion.cursor);
    setSelection(null);

    if (path) {
      DocumentService.applyEdit(path, startUtf16, endUtf16, "", deletion.lines.join("\n")).catch(
        console.error,
      );
    }
    updateMaxLineLength(deletion.lines);
    setTotalLines(deletion.lines.length);
    const nextContent = deletion.lines.join("\n");
    onEditCommitted?.(nextContent, getLineStartUtf16(deletion.lines, deletion.cursor.line) + deletion.cursor.char);
    onChange?.(nextContent);
  }, [
    documentLines,
    onChange,
    onEditCommitted,
    path,
    selection,
    setCursor,
    setDocumentLines,
    setSelection,
    setTotalLines,
    updateMaxLineLength,
  ]);

  const findWordBoundaries = useCallback((text: string, index: number) => {
    let start = index;
    let end = index;
    const wordCharRegex = /[a-zA-Z0-9_]/;
    while (start > 0 && wordCharRegex.test(text[start - 1])) {
      start--;
    }
    while (end < text.length && wordCharRegex.test(text[end])) {
      end++;
    }
    if (start === end && index < text.length) {
      end = index + 1;
    }
    return { start, end };
  }, []);

  const moveCursor = useCallback(
    (newLine: number, newChar: number, shift: boolean) => {
      const prevCursor = { ...cursor };
      const nextCursor = { line: newLine, char: newChar };

      if (shift) {
        setSelection((prev) => {
          if (!prev) {
            return { start: prevCursor, end: nextCursor };
          }
          return { start: prev.start, end: nextCursor };
        });
      } else {
        setSelection(null);
      }
      setCursor(nextCursor);
    },
    [cursor, setCursor, setSelection],
  );

  return {
    executeSelectionDelete,
    findWordBoundaries,
    moveCursor,
  };
}
