import { useCallback, useState } from "react";
import type { SelectionRange } from "../Hooks/useEditorSelectionOps";

export interface CursorPosition {
  line: number;
  char: number;
}

export function useMultiCursorOps(documentLines: string[]) {
  // 额外光标列表（主光标仍然由主编辑器状态维护）
  const [extraCursors, setExtraCursors] = useState<CursorPosition[]>([]);
  const [extraSelections, setExtraSelections] = useState<SelectionRange[]>([]);

  // 1. 添加一个新光标 (Alt + Click)
  const addCursor = useCallback((pos: CursorPosition) => {
    setExtraCursors((prev) => {
      // 避免重复添加同一个位置
      if (prev.some((c) => c.line === pos.line && c.char === pos.char)) {
        return prev;
      }
      return [...prev, pos];
    });
  }, []);

  // 2. 清除所有额外光标 (按 ESC 或单点主光标)
  const clearExtraCursors = useCallback(() => {
    setExtraCursors([]);
    setExtraSelections([]);
  }, []);

  // 3. Ctrl + D：查找并选中下一个匹配的相同单词
  const selectNextOccurrence = useCallback(
    (
      primaryCursor: CursorPosition,
      primarySelection: SelectionRange | null,
      findWordBoundaries: (lineText: string, char: number) => { start: number; end: number } | null,
    ) => {
      let targetWord = "";
      let currentSelection = primarySelection;

      if (!currentSelection) {
        // 如果当前没有选区，先选中光标所在的单词
        const lineText = documentLines[primaryCursor.line] || "";
        const wordBounds = findWordBoundaries(lineText, primaryCursor.char);
        if (!wordBounds || wordBounds.start === wordBounds.end) return null;

        targetWord = lineText.substring(wordBounds.start, wordBounds.end);
        currentSelection = {
          start: { line: primaryCursor.line, char: wordBounds.start },
          end: { line: primaryCursor.line, char: wordBounds.end },
        };
        return {
          newPrimarySelection: currentSelection,
          newPrimaryCursor: { line: primaryCursor.line, char: wordBounds.end },
        };
      }

      // 已有选区，向下搜索下一个 targetWord
      const { start, end } = currentSelection;
      targetWord = (documentLines[start.line] || "").substring(start.char, end.char);
      if (!targetWord) return null;

      // 搜索下一个匹配项
      let foundLine = -1;
      let foundChar = -1;

      // 先从当前行后半段开始找
      const startLineText = documentLines[end.line] || "";
      const searchInCurrent = startLineText.indexOf(targetWord, end.char);
      if (searchInCurrent !== -1) {
        foundLine = end.line;
        foundChar = searchInCurrent;
      } else {
        // 向下找后面的行
        for (let l = end.line + 1; l < documentLines.length; l++) {
          const idx = (documentLines[l] || "").indexOf(targetWord);
          if (idx !== -1) {
            foundLine = l;
            foundChar = idx;
            break;
          }
        }
      }

      // 环形回绕到文档开头
      if (foundLine === -1) {
        for (let l = 0; l <= start.line; l++) {
          const idx = (documentLines[l] || "").indexOf(targetWord);
          if (idx !== -1 && (l < start.line || idx < start.char)) {
            foundLine = l;
            foundChar = idx;
            break;
          }
        }
      }

      if (foundLine !== -1 && foundChar !== -1) {
        const nextSel: SelectionRange = {
          start: { line: foundLine, char: foundChar },
          end: { line: foundLine, char: foundChar + targetWord.length },
        };
        setExtraSelections((prev) => [...prev, nextSel]);
        setExtraCursors((prev) => [
          ...prev,
          { line: foundLine, char: foundChar + targetWord.length },
        ]);
      }

      return null;
    },
    [documentLines],
  );

  return {
    extraCursors,
    extraSelections,
    addCursor,
    clearExtraCursors,
    selectNextOccurrence,
  };
}
