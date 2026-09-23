import { useCallback, useMemo, useState } from "react";
import type { SelectionRange } from "../Hooks/useEditorSelectionOps";

export interface CursorPosition {
  line: number;
  char: number;
}

/** 额外光标：光标点 + 可选选区（Ctrl+D 选词时携带） */
export interface ExtraCursor {
  cursor: CursorPosition;
  selection: SelectionRange | null;
}

/** 多光标栈上限：额外光标数量达到上限后不再新增（列光标等批量路径使用） */
export const MAX_EXTRA_CURSORS = 100;

/** 词字符判定：与 useEditorSelectionOps.findWordBoundaries 保持一致 */
const WORD_CHAR = /[a-zA-Z0-9_]/;

/** 匹配位置是否为整词边界（前后字符都不是词字符） */
function isWordBounded(text: string, index: number, length: number): boolean {
  const before = index > 0 ? text[index - 1] : "";
  const after = index + length < text.length ? text[index + length] : "";
  return !WORD_CHAR.test(before) && !WORD_CHAR.test(after);
}

/** 从 from 起找下一个匹配位置；enforce 时跳过词中匹配（如 "const" 不命中 "constant"） */
function findOccurrenceFrom(text: string, word: string, from: number, enforce: boolean): number {
  let idx = text.indexOf(word, from);
  if (!enforce) return idx;
  while (idx !== -1 && !isWordBounded(text, idx, word.length)) {
    idx = text.indexOf(word, idx + 1);
  }
  return idx;
}

export function useMultiCursorOps(documentLines: string[]) {
  const [extras, setExtras] = useState<ExtraCursor[]>([]);
  const extraCursors = useMemo(() => extras.map((item) => item.cursor), [extras]);
  const extraSelections = useMemo(() => extras.map((item) => item.selection), [extras]);

  // 1. 添加一个新光标 (Alt + Click)
  const addCursor = useCallback((pos: CursorPosition) => {
    setExtras((prev) => {
      // 避免重复添加同一个位置
      if (prev.some((item) => item.cursor.line === pos.line && item.cursor.char === pos.char)) {
        return prev;
      }
      return [...prev, { cursor: pos, selection: null }];
    });
  }, []);

  // 2. 清除所有额外光标 (按 ESC 或单点主光标)
  const clearExtraCursors = useCallback(() => {
    setExtras([]);
  }, []);

  // 3. Ctrl + D：无选区时返回主光标词选区；已有选区时添加下一个匹配的额外光标
  const selectNextOccurrence = useCallback(
    (
      primaryCursor: CursorPosition,
      primarySelection: SelectionRange | null,
      findWordBoundaries: (lineText: string, char: number) => { start: number; end: number } | null,
    ): { newPrimarySelection: SelectionRange; newPrimaryCursor: CursorPosition } | null => {
      let targetWord = "";
      const currentSelection = primarySelection;

      if (!currentSelection) {
        // 如果当前没有选区，先选中光标所在的单词
        const lineText = documentLines[primaryCursor.line] || "";
        const wordBounds = findWordBoundaries(lineText, primaryCursor.char);
        if (!wordBounds || wordBounds.start === wordBounds.end) return null;

        targetWord = lineText.substring(wordBounds.start, wordBounds.end);
        return {
          newPrimarySelection: {
            start: { line: primaryCursor.line, char: wordBounds.start },
            end: { line: primaryCursor.line, char: wordBounds.end },
          },
          newPrimaryCursor: { line: primaryCursor.line, char: wordBounds.end },
        };
      }

      // 已有选区，向下搜索下一个 targetWord
      const { start, end } = currentSelection;
      targetWord = (documentLines[start.line] || "").substring(start.char, end.char);
      if (!targetWord) return null;

      // 目标词首尾均为词字符时启用整词校验（词中匹配跳过，如 "const" 不命中 "constant"）
      const enforceWordBoundary =
        WORD_CHAR.test(targetWord[0]) && WORD_CHAR.test(targetWord[targetWord.length - 1]);

      // 搜索下一个匹配项
      let foundLine = -1;
      let foundChar = -1;

      // 先从当前行后半段开始找
      const startLineText = documentLines[end.line] || "";
      const searchInCurrent = findOccurrenceFrom(
        startLineText,
        targetWord,
        end.char,
        enforceWordBoundary,
      );
      if (searchInCurrent !== -1) {
        foundLine = end.line;
        foundChar = searchInCurrent;
      } else {
        // 向下找后面的行
        for (let l = end.line + 1; l < documentLines.length; l++) {
          const idx = findOccurrenceFrom(
            documentLines[l] || "",
            targetWord,
            0,
            enforceWordBoundary,
          );
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
          const idx = findOccurrenceFrom(
            documentLines[l] || "",
            targetWord,
            0,
            enforceWordBoundary,
          );
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
        setExtras((prev) => {
          const nextCursorPos = { line: foundLine, char: foundChar + targetWord.length };
          if (
            prev.some(
              (item) =>
                item.cursor.line === nextCursorPos.line && item.cursor.char === nextCursorPos.char,
            )
          ) {
            return prev;
          }
          return [...prev, { cursor: nextCursorPos, selection: nextSel }];
        });
      }

      return null;
    },
    [documentLines],
  );

  /**
   * Alt+Shift+I：在每个选区行尾放置光标（多选区逐个）；
   * 单选区/无选区时返回主光标所在行行尾。返回主光标新位置（由引擎应用），
   * 副光标经 replaceExtras 内部更新；无需变更时返回 null。
   */
  const addCursorAtSelectionEnds = useCallback(
    (
      primaryCursor: CursorPosition,
      primarySelection: SelectionRange | null,
    ): CursorPosition | null => {
      const lineEnd = (line: number): CursorPosition => ({
        line,
        char: (documentLines[line] || "").length,
      });

      // 无副光标：主光标（或其选区末行）行尾
      if (extras.length === 0) {
        return primarySelection ? lineEnd(primarySelection.end.line) : lineEnd(primaryCursor.line);
      }

      // 多选区：每个选区末行行尾一个光标；无选区的副光标降级为其所在行行尾
      const seen = new Set<string>();
      const toKey = (pos: CursorPosition) => `${pos.line}:${pos.char}`;
      const nextExtras: ExtraCursor[] = [];
      const pushUnique = (pos: CursorPosition) => {
        const key = toKey(pos);
        if (seen.has(key)) return;
        seen.add(key);
        nextExtras.push({ cursor: pos, selection: null });
      };
      for (const item of extras) {
        pushUnique(lineEnd(item.selection ? item.selection.end.line : item.cursor.line));
      }
      const primaryTarget = primarySelection
        ? lineEnd(primarySelection.end.line)
        : lineEnd(primaryCursor.line);
      // 主光标位置优先：与其他目标重合时 extras 去掉重复项
      const filteredExtras = nextExtras.filter(
        (item) => toKey(item.cursor) !== toKey(primaryTarget),
      );
      setExtras((prev) => {
        const sameAsPrev =
          prev.length === filteredExtras.length &&
          prev.every((item, index) => toKey(item.cursor) === toKey(filteredExtras[index].cursor));
        return sameAsPrev ? prev : filteredExtras;
      });
      return primaryTarget;
    },
    [documentLines, extras],
  );

  /**
   * Ctrl+Alt+Up/Down 列光标：在每个光标正上/正下方同列加光标；
   * 超出行数范围即停，重复位置去重，受 MAX_EXTRA_CURSORS 上限约束。
   */
  const addColumnCursors = useCallback(
    (primaryCursor: CursorPosition, direction: -1 | 1) => {
      const lineCount = documentLines.length;
      setExtras((prev) => {
        const toKey = (pos: CursorPosition) => `${pos.line}:${pos.char}`;
        const seen = new Set(prev.map((item) => toKey(item.cursor)));
        seen.add(toKey(primaryCursor));
        const added: ExtraCursor[] = [];
        const sources: CursorPosition[] = [primaryCursor, ...prev.map((item) => item.cursor)];
        for (const source of sources) {
          if (prev.length + added.length >= MAX_EXTRA_CURSORS) break;
          const targetLine = source.line + direction;
          // 到顶/底即停
          if (targetLine < 0 || targetLine > lineCount - 1) continue;
          const target: CursorPosition = {
            line: targetLine,
            char: Math.min(source.char, (documentLines[targetLine] || "").length),
          };
          const key = toKey(target);
          if (seen.has(key)) continue;
          seen.add(key);
          added.push({ cursor: target, selection: null });
        }
        return added.length > 0 ? [...prev, ...added] : prev;
      });
    },
    [documentLines],
  );

  /** 批量编辑后整体替换额外光标状态 */
  const replaceExtras = useCallback((next: ExtraCursor[]) => {
    setExtras(next);
  }, []);

  return {
    extras,
    extraCursors,
    extraSelections,
    addCursor,
    clearExtraCursors,
    selectNextOccurrence,
    addCursorAtSelectionEnds,
    addColumnCursors,
    replaceExtras,
  };
}
