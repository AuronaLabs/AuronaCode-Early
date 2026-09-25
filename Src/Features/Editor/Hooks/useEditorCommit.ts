import type React from "react";
import { useCallback, useRef } from "react";
import { DocumentService } from "../../../Core/DocumentService";
import { sortSelection } from "../Utils/EditorMath";
import { insertTextIntoLines } from "../Utils/EditorTextInsert";
import { diffText, type HistoryExtra } from "./useEditorHistory";
import {
  getCursorFromUtf16Offset,
  getLineStartUtf16,
  type SelectionRange,
} from "./useEditorSelectionOps";

export type EditorPos = { line: number; char: number };

export interface ExtraCursorItem {
  cursor: EditorPos;
  selection: SelectionRange | null;
}

/** 副光标行/列坐标 ↔ 撤销栈 utf16 偏移快照互转（undo/redo 还原多光标布局用） */
export function extrasToUtf16(lines: string[], items: ExtraCursorItem[]): HistoryExtra[] {
  return items.map((item) => {
    const cursor = getLineStartUtf16(lines, item.cursor.line) + item.cursor.char;
    if (!item.selection) return { cursor, selectionStart: cursor, selectionEnd: cursor };
    const start = getLineStartUtf16(lines, item.selection.start.line) + item.selection.start.char;
    const end = getLineStartUtf16(lines, item.selection.end.line) + item.selection.end.char;
    return { cursor, selectionStart: start, selectionEnd: end };
  });
}

export function extrasFromUtf16(lines: string[], items: HistoryExtra[]): ExtraCursorItem[] {
  return items.map((item) => {
    const cursor = getCursorFromUtf16Offset(lines, item.cursor);
    if (item.selectionStart === item.selectionEnd) return { cursor, selection: null };
    return {
      cursor,
      selection: {
        start: getCursorFromUtf16Offset(lines, item.selectionStart),
        end: getCursorFromUtf16Offset(lines, item.selectionEnd),
      },
    };
  });
}

export interface MultiCursorEditRange {
  start: EditorPos;
  end: EditorPos;
  text: string;
  isPrimary: boolean;
  cursorOffsetInText: number;
}

type OffsetEdit = { startUtf16: number; endUtf16: number; text: string };

export function cursorOffsetAfterBatchEdits(
  originalOffset: number,
  edits: readonly OffsetEdit[],
  ownEdit?: { startUtf16: number; cursorOffsetInText: number },
): number {
  const ordered = [...edits].sort((a, b) => a.startUtf16 - b.startUtf16);
  let shift = 0;
  for (const edit of ordered) {
    const delta = edit.text.length - (edit.endUtf16 - edit.startUtf16);
    if (ownEdit) {
      if (edit.startUtf16 < ownEdit.startUtf16) shift += delta;
    } else if (edit.endUtf16 <= originalOffset) {
      shift += delta;
    } else if (edit.startUtf16 <= originalOffset) {
      return edit.startUtf16 + shift + Math.min(originalOffset - edit.startUtf16, edit.text.length);
    } else {
      break;
    }
  }
  return ownEdit ? ownEdit.startUtf16 + ownEdit.cursorOffsetInText + shift : originalOffset + shift;
}

type TriggerAutocomplete = (
  lines: string[],
  lineIndex: number,
  charIndex: number,
  manual?: boolean,
) => void;

export interface UseEditorCommitParams {
  documentLines: string[];
  cursor: EditorPos;
  selection: SelectionRange | null;
  extras: ExtraCursorItem[];
  path?: string;
  onChange?: (value: string) => void;
  onSyncError?: (error: Error) => void;
  setDocumentLines: React.Dispatch<React.SetStateAction<string[]>>;
  setTotalLines: (total: number) => void;
  setCursor: (cursor: EditorPos) => void;
  setSelection: React.Dispatch<React.SetStateAction<SelectionRange | null>>;
  updateMaxLineLength: (lines: string[]) => void;
  pushHistory: (
    content: string,
    cursorUtf16: number,
    beforeExtras?: HistoryExtra[],
    afterExtras?: HistoryExtra[],
  ) => void;
  pushComposite: (
    edits: { startUtf16: number; deletedText: string; insertedText: string }[],
    cursorUtf16: number,
    content: string,
    beforeExtras?: HistoryExtra[],
    afterExtras?: HistoryExtra[],
  ) => void;
  undo: () => { content: string; selectionStart: number; extras?: HistoryExtra[] } | null;
  redo: () => { content: string; selectionStart: number; extras?: HistoryExtra[] } | null;
  replaceExtras: (items: ExtraCursorItem[]) => void;
  /** 经 ref 注入以打破「补全 hook 依赖 commitEdit、commit 路径又要触发补全」的循环 */
  triggerAutocompleteRef: React.RefObject<TriggerAutocomplete>;
  /** IME onCommitText 在 hooks 装配完成前就可能触发，ref 由引擎持有 */
  insertTextAtCursorRef: React.RefObject<(text: string) => void>;
}

/**
 * 统一编辑提交点：commitEdit（状态 + 撤销入栈 + 单差异区间 IPC 落盘）、
 * 撤销/重做落盘、多光标批量编辑（内存合并 + 一次降序批量 IPC + composite 撤销）
 * 与光标处插入（含选区替换）。
 */
export function useEditorCommit({
  documentLines,
  cursor,
  selection,
  extras,
  path,
  onChange,
  onSyncError,
  setDocumentLines,
  setTotalLines,
  setCursor,
  setSelection,
  updateMaxLineLength,
  pushHistory,
  pushComposite,
  undo,
  redo,
  replaceExtras,
  triggerAutocompleteRef,
  insertTextAtCursorRef,
}: UseEditorCommitParams) {
  // 精确写盘：计算旧内容到新内容的单连续差异区间，只把差异段传给 Rust，
  // 避免 Backspace/Delete/Enter/行操作等按键路径整文序列化重建 rope。
  const applyContentDiff = useCallback(
    (currentContent: string, nextContent: string) => {
      if (!path) return;
      const difference = diffText(currentContent, nextContent);
      DocumentService.applyEdit(
        path,
        difference.startUtf16,
        difference.startUtf16 + difference.deletedText.length,
        difference.insertedText,
        nextContent,
      ).catch((error) => {
        onSyncError?.(error instanceof Error ? error : new Error(String(error)));
      });
    },
    [onSyncError, path],
  );

  // 统一编辑提交点：状态更新 + 撤销入栈 + IPC 落盘，所有编辑路径（按键/IME/替换）都经此提交
  const commitEdit = useCallback(
    (nextLines: string[], nextCursor: EditorPos, nextSelection: SelectionRange | null = null) => {
      const currentContent = documentLines.join("\n");
      const nextContent = nextLines.join("\n");
      setDocumentLines(nextLines);
      setTotalLines(nextLines.length);
      setCursor(nextCursor);
      setSelection(nextSelection);
      updateMaxLineLength(nextLines);
      pushHistory(
        nextContent,
        getLineStartUtf16(nextLines, nextCursor.line) + nextCursor.char,
        extrasToUtf16(documentLines, extras),
      );
      applyContentDiff(currentContent, nextContent);
      onChange?.(nextContent);
    },
    [
      applyContentDiff,
      documentLines,
      extras,
      onChange,
      pushHistory,
      updateMaxLineLength,
      setCursor,
      setSelection,
      setDocumentLines,
      setTotalLines,
    ],
  );

  // 按键类编辑入口（Backspace/Delete/Enter/Tab/行操作等 keybinding 路径）
  const replaceDocumentLines = commitEdit;

  const handleUndo = useCallback(() => {
    const entry = undo();
    if (!entry) return;
    const lines = entry.content.split("\n");
    const nextCursor = getCursorFromUtf16Offset(lines, entry.selectionStart);
    setDocumentLines(lines);
    setTotalLines(lines.length);
    setCursor(nextCursor);
    setSelection(null);
    // 多光标编辑撤销：还原编辑前的副光标布局（快照为 utf16 偏移，映射回行/列）
    if (entry.extras) replaceExtras(extrasFromUtf16(lines, entry.extras));
    updateMaxLineLength(lines);
    applyContentDiff(documentLines.join("\n"), entry.content);
    onChange?.(entry.content);
  }, [
    applyContentDiff,
    documentLines,
    onChange,
    replaceExtras,
    undo,
    updateMaxLineLength,
    setDocumentLines,
    setSelection,
    setCursor,
    setTotalLines,
  ]);

  const handleRedo = useCallback(() => {
    const entry = redo();
    if (!entry) return;
    const lines = entry.content.split("\n");
    const nextCursor = getCursorFromUtf16Offset(lines, entry.selectionStart);
    setDocumentLines(lines);
    setTotalLines(lines.length);
    setCursor(nextCursor);
    setSelection(null);
    // 多光标编辑重做：还原编辑后的副光标布局
    if (entry.extras) replaceExtras(extrasFromUtf16(lines, entry.extras));
    updateMaxLineLength(lines);
    applyContentDiff(documentLines.join("\n"), entry.content);
    onChange?.(entry.content);
  }, [
    applyContentDiff,
    documentLines,
    onChange,
    redo,
    replaceExtras,
    updateMaxLineLength,
    setSelection,
    setTotalLines,
    setDocumentLines,
    setCursor,
  ]);

  // 多光标批量编辑：内存合并 + 一次降序批量 IPC + composite 一步撤销
  const commitMultiCursorEdits = useCallback(
    (ranges: MultiCursorEditRange[]) => {
      if (ranges.length === 0) return;
      const originalContent = documentLines.join("\n");
      const withOffsets = ranges.map((range) => ({
        ...range,
        startUtf16: getLineStartUtf16(documentLines, range.start.line) + range.start.char,
        endUtf16: getLineStartUtf16(documentLines, range.end.line) + range.end.char,
      }));
      // 降序排列：坐标互不重叠时在中间文档上依然正确
      withOffsets.sort((a, b) => b.startUtf16 - a.startUtf16);
      const applied: typeof withOffsets = [];
      let lastStart = Number.MAX_SAFE_INTEGER;
      for (const item of withOffsets) {
        // 与右侧已应用区间重叠（如重复光标）：防御性跳过
        if (item.endUtf16 > lastStart || item.startUtf16 === lastStart) continue;
        applied.push(item);
        lastStart = item.startUtf16;
      }
      if (applied.length === 0) return;

      let nextContent = originalContent;
      for (const item of applied) {
        nextContent =
          nextContent.slice(0, item.startUtf16) + item.text + nextContent.slice(item.endUtf16);
      }
      const nextLines = nextContent.split("\n");

      // 新光标：extras 按原位置升序重建；被跳过的区间光标保持原位
      const skipped = withOffsets.filter((item) => !applied.includes(item));
      const primary = applied.find((item) => item.isPrimary);
      const primarySkipped = skipped.find((item) => item.isPrimary);
      const extraEdits = applied.filter((item) => !item.isPrimary);
      const nextExtras = [
        ...extraEdits
          .sort((a, b) => a.startUtf16 - b.startUtf16)
          .map((item) => ({
            cursor: getCursorFromUtf16Offset(
              nextLines,
              cursorOffsetAfterBatchEdits(item.startUtf16, applied, item),
            ),
            selection: null,
          })),
        ...skipped
          .filter((item) => !item.isPrimary)
          .sort((a, b) => a.startUtf16 - b.startUtf16)
          .map((item) => ({
            cursor: getCursorFromUtf16Offset(
              nextLines,
              cursorOffsetAfterBatchEdits(item.startUtf16, applied),
            ),
            selection: null,
          })),
      ];

      setDocumentLines(nextLines);
      setTotalLines(nextLines.length);
      const primaryCursorUtf16 = primary
        ? cursorOffsetAfterBatchEdits(primary.startUtf16, applied, primary)
        : cursorOffsetAfterBatchEdits(
            primarySkipped?.startUtf16 ??
              getLineStartUtf16(documentLines, cursor.line) + cursor.char,
            applied,
          );
      if (primary || primarySkipped) {
        setCursor(getCursorFromUtf16Offset(nextLines, primaryCursorUtf16));
        setSelection(null);
      }
      replaceExtras(nextExtras);
      updateMaxLineLength(nextLines);

      pushComposite(
        applied.map((item) => ({
          startUtf16: item.startUtf16,
          deletedText: originalContent.slice(item.startUtf16, item.endUtf16),
          insertedText: item.text,
        })),
        primaryCursorUtf16,
        nextContent,
        extrasToUtf16(documentLines, extras),
        extrasToUtf16(nextLines, nextExtras),
      );

      if (path) {
        DocumentService.applyEdits(
          path,
          applied.map((item) => ({
            startUtf16: item.startUtf16,
            endUtf16: item.endUtf16,
            text: item.text,
          })),
          nextContent,
        ).catch((error) => {
          onSyncError?.(error instanceof Error ? error : new Error(String(error)));
        });
      }
      if (primary) {
        triggerAutocompleteRef.current?.(
          nextLines,
          getCursorFromUtf16Offset(nextLines, primaryCursorUtf16).line,
          getCursorFromUtf16Offset(nextLines, primaryCursorUtf16).char,
        );
      }
      onChange?.(nextContent);
    },
    [
      cursor,
      documentLines,
      extras,
      onChange,
      onSyncError,
      path,
      pushComposite,
      replaceExtras,
      triggerAutocompleteRef,
      updateMaxLineLength,
      setTotalLines,
      setDocumentLines,
      setSelection,
      setCursor,
    ],
  );

  // 收集主光标 + 额外光标的编辑区间（点或选区）
  const collectMultiCursorRanges = useCallback(() => {
    const ranges: { start: EditorPos; end: EditorPos; isPrimary: boolean }[] = [];
    if (selection) {
      const sorted = sortSelection(selection);
      ranges.push({ start: sorted.start, end: sorted.end, isPrimary: true });
    } else {
      ranges.push({ start: cursor, end: cursor, isPrimary: true });
    }
    extras.forEach((item) => {
      if (item.selection) {
        const sorted = sortSelection(item.selection);
        ranges.push({ start: sorted.start, end: sorted.end, isPrimary: false });
      } else {
        ranges.push({ start: item.cursor, end: item.cursor, isPrimary: false });
      }
    });
    return ranges;
  }, [cursor, extras, selection]);

  // 多光标批量插入转发 ref：insertTextAtCursor 定义在前，批量路径定义在后
  const multiCursorInsertRef = useRef<((text: string) => void) | null>(null);

  const handleMultiCursorInsert = useCallback(
    (text: string) => {
      commitMultiCursorEdits(
        collectMultiCursorRanges().map((range) => ({
          ...range,
          text,
          cursorOffsetInText: text.length,
        })),
      );
    },
    [collectMultiCursorRanges, commitMultiCursorEdits],
  );
  multiCursorInsertRef.current = handleMultiCursorInsert;

  const handleMultiCursorBackspace = useCallback(() => {
    const ranges = collectMultiCursorRanges().map((range) => {
      if (range.start.line === range.end.line && range.start.char === range.end.char) {
        if (range.start.char > 0) {
          return {
            ...range,
            start: { line: range.start.line, char: range.start.char - 1 },
            text: "",
            cursorOffsetInText: 0,
          };
        }
        if (range.start.line > 0) {
          // 行首退格：与前一行合并（删除换行符）
          const prevLength = (documentLines[range.start.line - 1] || "").length;
          return {
            ...range,
            start: { line: range.start.line - 1, char: prevLength },
            text: "",
            cursorOffsetInText: 0,
          };
        }
        // 文档起点无处可删：零宽无操作，光标保持
        return { ...range, text: "", cursorOffsetInText: 0 };
      }
      return { ...range, text: "", cursorOffsetInText: 0 };
    });
    commitMultiCursorEdits(ranges);
  }, [collectMultiCursorRanges, commitMultiCursorEdits, documentLines]);

  const handleMultiCursorDelete = useCallback(() => {
    const ranges = collectMultiCursorRanges().map((range) => {
      if (range.start.line === range.end.line && range.start.char === range.end.char) {
        const lineText = documentLines[range.end.line] || "";
        if (range.end.char < lineText.length) {
          return {
            ...range,
            end: { line: range.end.line, char: range.end.char + 1 },
            text: "",
            cursorOffsetInText: 0,
          };
        }
        if (range.end.line < documentLines.length - 1) {
          // 行尾删除：与下一行合并
          return {
            ...range,
            end: { line: range.end.line + 1, char: 0 },
            text: "",
            cursorOffsetInText: 0,
          };
        }
        return { ...range, text: "", cursorOffsetInText: 0 };
      }
      return { ...range, text: "", cursorOffsetInText: 0 };
    });
    commitMultiCursorEdits(ranges);
  }, [collectMultiCursorRanges, commitMultiCursorEdits, documentLines]);

  const handleMultiCursorEnter = useCallback(() => {
    commitMultiCursorEdits(
      collectMultiCursorRanges().map((range) => {
        const lineText = documentLines[range.start.line] || "";
        const indent = lineText.match(/^(\s*)/)?.[1] ?? "";
        const insert = `\n${indent}`;
        return { ...range, text: insert, cursorOffsetInText: insert.length };
      }),
    );
  }, [collectMultiCursorRanges, commitMultiCursorEdits, documentLines]);

  const insertTextAtCursor = useCallback(
    (text: string) => {
      // 多光标批量插入：每个光标/选区插入相同文本，一步撤销（批量路径定义在后，经 ref 转发）
      if (extras.length > 0 && multiCursorInsertRef.current) {
        multiCursorInsertRef.current(text);
        return;
      }
      if (selection) {
        // 选中状态：删除选区并在选区起点插入，一次合并提交（单步撤销）。
        // 不能依赖 executeSelectionDelete 的异步 setState——后续计算会拿到删除前的行。
        const { start, end } = sortSelection(selection);
        const nextLines = [...documentLines];
        const startLineText = nextLines[start.line] || "";
        const endLineText = nextLines[end.line] || "";
        nextLines.splice(
          start.line,
          end.line - start.line + 1,
          startLineText.substring(0, start.char) + text + endLineText.substring(end.char),
        );
        const nextCursor = { line: start.line, char: start.char + text.length };
        const nextContent = nextLines.join("\n");

        setDocumentLines(nextLines);
        setTotalLines(nextLines.length);
        setCursor(nextCursor);
        setSelection(null);
        updateMaxLineLength(nextLines);
        pushHistory(nextContent, getLineStartUtf16(nextLines, nextCursor.line) + nextCursor.char);
        if (path) {
          const startUtf16 = getLineStartUtf16(documentLines, start.line) + start.char;
          const endUtf16 = getLineStartUtf16(documentLines, end.line) + end.char;
          DocumentService.applyEdit(path, startUtf16, endUtf16, text, nextContent).catch(
            (error) => {
              onSyncError?.(error instanceof Error ? error : new Error(String(error)));
            },
          );
        }
        triggerAutocompleteRef.current?.(nextLines, nextCursor.line, nextCursor.char);
        onChange?.(nextContent);
        return;
      }

      const currentLines = [...documentLines];
      const inserted = insertTextIntoLines(currentLines, cursor, text);
      const insertedContent = inserted.lines.join("\n");
      setDocumentLines(inserted.lines);
      setCursor(inserted.cursor);
      setSelection(null);

      pushHistory(
        insertedContent,
        getLineStartUtf16(inserted.lines, inserted.cursor.line) + inserted.cursor.char,
      );

      if (path) {
        const startUtf16 = getLineStartUtf16(currentLines, cursor.line) + cursor.char;
        DocumentService.applyEdit(path, startUtf16, startUtf16, text, insertedContent).catch(
          (error) => {
            onSyncError?.(error instanceof Error ? error : new Error(String(error)));
          },
        );
        triggerAutocompleteRef.current?.(
          inserted.lines,
          inserted.cursor.line,
          inserted.cursor.char,
        );
      }

      updateMaxLineLength(inserted.lines);
      setTotalLines(inserted.lines.length);
      onChange?.(insertedContent);
    },
    [
      cursor,
      documentLines,
      extras.length,
      onChange,
      onSyncError,
      path,
      pushHistory,
      selection,
      triggerAutocompleteRef,
      updateMaxLineLength,
      setDocumentLines,
      setTotalLines,
      setSelection,
      setCursor,
    ],
  );
  insertTextAtCursorRef.current = insertTextAtCursor;

  return {
    applyContentDiff,
    commitEdit,
    replaceDocumentLines,
    handleUndo,
    handleRedo,
    commitMultiCursorEdits,
    collectMultiCursorRanges,
    insertTextAtCursor,
    handleMultiCursorInsert,
    handleMultiCursorBackspace,
    handleMultiCursorDelete,
    handleMultiCursorEnter,
  };
}
