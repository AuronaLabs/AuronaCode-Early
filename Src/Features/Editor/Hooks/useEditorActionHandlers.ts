import { useCallback } from "react";
import { LocaleService } from "../../../Foundation/I18n";
import { showToast } from "../../../UI/Feedback/Toast";
import type { CursorPosition, ExtraCursor } from "../MultiCursor/useMultiCursorOps";
import {
  affectedLineRange,
  duplicateLineRange,
  moveLineRange,
  toggleLineComment,
} from "../Utils/EditorLineOperations";
import type { SelectionRange } from "./useEditorSelectionOps";

export interface UseEditorActionHandlersParams {
  language: string;
  documentLines: string[];
  cursor: CursorPosition;
  selection: SelectionRange | null;
  extras: ExtraCursor[];
  /** editor.trueFolding 特性开关：关闭时折叠命令不生效 */
  hasTrueFolding: boolean;
  replaceDocumentLines: (
    nextLines: string[],
    nextCursor: CursorPosition,
    nextSelection?: SelectionRange | null,
  ) => void;
  clearExtraCursors: () => void;
  setCursor: (cursor: CursorPosition) => void;
  setSelection: React.Dispatch<React.SetStateAction<SelectionRange | null>>;
  foldAll: () => void;
  unfoldAll: () => void;
  /** 多选区行尾加光标：返回主光标新位置（null = 无变化），副光标在 hook 内更新 */
  addCursorAtSelectionEnds: (
    primaryCursor: CursorPosition,
    primarySelection: SelectionRange | null,
  ) => CursorPosition | null;
}

/**
 * 编辑能力命令化（V0.4.8）：EditorAction 命令路径（右键菜单 / 命令面板）的行操作、
 * 折叠与多光标动作实现。键盘路径（Ctrl+/、Alt+Up/Down 等）仍走 useEditorKeybindings。
 */
export function useEditorActionHandlers({
  language,
  documentLines,
  cursor,
  selection,
  extras,
  hasTrueFolding,
  replaceDocumentLines,
  clearExtraCursors,
  setCursor,
  setSelection,
  foldAll,
  unfoldAll,
  addCursorAtSelectionEnds,
}: UseEditorActionHandlersParams) {
  /** 多光标下行操作降级为主光标（与键盘路径行为一致） */
  const degradeMultiCursor = useCallback(() => {
    if (extras.length > 0) {
      clearExtraCursors();
      showToast(LocaleService.translate("editor.multiCursorLineOpsDegrade"));
    }
  }, [clearExtraCursors, extras.length]);

  const handleToggleLineComment = useCallback(() => {
    degradeMultiCursor();
    const marker = ["python", "shellscript", "yaml", "toml", "powershell"].includes(language)
      ? "#"
      : ["html", "css", "scss", "markdown", "plaintext"].includes(language)
        ? null
        : "//";
    if (!marker) return;
    const lines = [...documentLines];
    const range = affectedLineRange(cursor.line, selection);
    const result = toggleLineComment(lines, range, marker);
    const delta = marker.length + 1;
    const adjust = (position: CursorPosition) => ({
      line: position.line,
      char:
        position.line >= range.startLine && position.line <= range.endLine
          ? Math.max(0, position.char + (result.uncommented ? -delta : delta))
          : position.char,
    });
    const nextSelection = selection
      ? { start: adjust(selection.start), end: adjust(selection.end) }
      : null;
    replaceDocumentLines(result.lines, adjust(cursor), nextSelection);
  }, [cursor, degradeMultiCursor, documentLines, language, replaceDocumentLines, selection]);

  const handleMoveLine = useCallback(
    (direction: -1 | 1) => {
      degradeMultiCursor();
      const lines = [...documentLines];
      const range = affectedLineRange(cursor.line, selection);
      const result = moveLineRange(lines, range, direction);
      const lineDelta = result.range.startLine - range.startLine;
      if (lineDelta === 0) return;
      const nextSelection = selection
        ? {
            start: { ...selection.start, line: selection.start.line + lineDelta },
            end: { ...selection.end, line: selection.end.line + lineDelta },
          }
        : null;
      replaceDocumentLines(
        result.lines,
        { ...cursor, line: cursor.line + lineDelta },
        nextSelection,
      );
    },
    [cursor, degradeMultiCursor, documentLines, replaceDocumentLines, selection],
  );

  const handleCopyLineDown = useCallback(() => {
    degradeMultiCursor();
    const lines = [...documentLines];
    const range = affectedLineRange(cursor.line, selection);
    const result = duplicateLineRange(lines, range);
    const lineDelta = result.range.startLine - range.startLine;
    const nextSelection = selection
      ? {
          start: { ...selection.start, line: selection.start.line + lineDelta },
          end: { ...selection.end, line: selection.end.line + lineDelta },
        }
      : null;
    replaceDocumentLines(result.lines, { ...cursor, line: cursor.line + lineDelta }, nextSelection);
  }, [cursor, degradeMultiCursor, documentLines, replaceDocumentLines, selection]);

  const handleDeleteLine = useCallback(() => {
    degradeMultiCursor();
    const lines = [...documentLines];
    const range = affectedLineRange(cursor.line, selection);
    const removedCount = range.endLine - range.startLine + 1;
    if (removedCount >= lines.length) {
      // 整个文档都在删除范围内：清空为单空行
      replaceDocumentLines([""], { line: 0, char: 0 }, null);
      return;
    }
    const nextLines = [...lines];
    nextLines.splice(range.startLine, removedCount);
    const nextLine = Math.min(range.startLine, nextLines.length - 1);
    const nextChar = Math.min(cursor.char, (nextLines[nextLine] || "").length);
    replaceDocumentLines(nextLines, { line: nextLine, char: nextChar }, null);
  }, [cursor, degradeMultiCursor, documentLines, replaceDocumentLines, selection]);

  const handleFoldAll = useCallback(() => {
    if (!hasTrueFolding) return;
    foldAll();
  }, [foldAll, hasTrueFolding]);

  const handleUnfoldAll = useCallback(() => {
    if (!hasTrueFolding) return;
    unfoldAll();
  }, [hasTrueFolding, unfoldAll]);

  const handleAddCursorAtSelectionEnds = useCallback(() => {
    const target = addCursorAtSelectionEnds(cursor, selection);
    if (!target) return;
    setSelection(null);
    setCursor(target);
  }, [addCursorAtSelectionEnds, cursor, selection, setCursor, setSelection]);

  return {
    handleToggleLineComment,
    handleMoveLine,
    handleCopyLineDown,
    handleDeleteLine,
    handleFoldAll,
    handleUnfoldAll,
    handleAddCursorAtSelectionEnds,
  };
}
