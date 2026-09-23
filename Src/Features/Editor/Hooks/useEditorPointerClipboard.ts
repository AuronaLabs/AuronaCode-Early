import type React from "react";
import { type RefObject, useCallback } from "react";
import type { EditorAction } from "../../../Foundation/Types/Editor";
import type { CompletionItem } from "../../../Foundation/Types/Lsp";
import {
  type EditorLayoutMetrics,
  editorTextIndexAtX,
  editorTextIndexFromPoint,
} from "../Utils/EditorLayoutMetrics";
import { sortSelection } from "../Utils/EditorMath";
import { useEditorContextMenu } from "./useEditorContextMenu";
import { useEditorPointerSelection } from "./useEditorPointerSelection";
import type { SelectionRange } from "./useEditorSelectionOps";

export interface UseEditorPointerClipboardParams {
  documentLines: string[];
  cursor: { line: number; char: number };
  selection: SelectionRange | null;
  totalLines: number;
  layout: EditorLayoutMetrics;
  containerRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  lineElementsRef: RefObject<Map<number, HTMLButtonElement>>;
  /** 来自 useEditorCompletion：指针拖拽状态与补全/hover 打断 */
  isDraggingPointerRef: RefObject<boolean>;
  setHoverContextMenuOpen: (open: boolean) => void;
  setCompletions: React.Dispatch<React.SetStateAction<CompletionItem[]>>;
  dismissHover: () => void;
  executeSelectionDelete: () => void;
  findWordBoundaries: (lineText: string, charIndex: number) => { start: number; end: number };
  setSelection: React.Dispatch<React.SetStateAction<SelectionRange | null>>;
  setCursor: React.Dispatch<React.SetStateAction<{ line: number; char: number }>>;
  handleUndo: () => void;
  handleRedo: () => void;
  /** 编辑能力命令化（V0.4.8）：行操作 / 折叠 / 多光标动作由引擎注入 */
  handleToggleLineComment: () => void;
  handleMoveLine: (direction: -1 | 1) => void;
  handleCopyLineDown: () => void;
  handleDeleteLine: () => void;
  handleFoldAll: () => void;
  handleUnfoldAll: () => void;
  handleAddCursorAtSelectionEnds: () => void;
}

/** 指针选区、剪贴板（剪切/复制/整行复制回退）与编辑器上下文菜单动作。 */
export function useEditorPointerClipboard({
  documentLines,
  cursor,
  selection,
  totalLines,
  layout,
  containerRef,
  textareaRef,
  lineElementsRef,
  isDraggingPointerRef,
  setHoverContextMenuOpen,
  setCompletions,
  dismissHover,
  executeSelectionDelete,
  findWordBoundaries,
  setSelection,
  setCursor,
  handleUndo,
  handleRedo,
  handleToggleLineComment,
  handleMoveLine,
  handleCopyLineDown,
  handleDeleteLine,
  handleFoldAll,
  handleUnfoldAll,
  handleAddCursorAtSelectionEnds,
}: UseEditorPointerClipboardParams) {
  const getSelectionText = useCallback((): string => {
    if (!selection) return "";
    const { start, end } = sortSelection(selection);
    if (start.line === end.line) {
      return (documentLines[start.line] || "").substring(start.char, end.char);
    }
    const result: string[] = [(documentLines[start.line] || "").substring(start.char)];
    for (let i = start.line + 1; i < end.line; i++) result.push(documentLines[i] || "");
    result.push((documentLines[end.line] || "").substring(0, end.char));
    return result.join("\n");
  }, [documentLines, selection]);

  const handleCut = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const selText = getSelectionText();
    if (selText && selection) {
      e.clipboardData.setData("text/plain", selText);
      executeSelectionDelete();
    }
  };

  const handleCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.clipboardData.setData(
      "text/plain",
      getSelectionText() || `${documentLines[cursor.line] || ""}\n`,
    );
  };

  const executeEditorAction = useCallback(
    (action: EditorAction) => {
      textareaRef.current?.focus();
      if (action === "undo") handleUndo();
      else if (action === "redo") handleRedo();
      else if (action === "cut" && selection) executeSelectionDelete();
      else if (action === "selectAll") {
        setSelection({
          start: { line: 0, char: 0 },
          end: {
            line: documentLines.length - 1,
            char: documentLines[documentLines.length - 1].length,
          },
        });
      } else if (action === "toggleLineComment") handleToggleLineComment();
      else if (action === "moveLineUp") handleMoveLine(-1);
      else if (action === "moveLineDown") handleMoveLine(1);
      else if (action === "copyLineDown") handleCopyLineDown();
      else if (action === "deleteLine") handleDeleteLine();
      else if (action === "foldAll") handleFoldAll();
      else if (action === "unfoldAll") handleUnfoldAll();
      else if (action === "addCursorAtSelectionEnds") handleAddCursorAtSelectionEnds();
    },
    [
      documentLines,
      executeSelectionDelete,
      handleRedo,
      handleUndo,
      handleToggleLineComment,
      handleMoveLine,
      handleCopyLineDown,
      handleDeleteLine,
      handleFoldAll,
      handleUnfoldAll,
      handleAddCursorAtSelectionEnds,
      selection,
      textareaRef.current?.focus,
      setSelection,
    ],
  );

  // 指针交互
  const minTextLengthIndex = useCallback(
    (text: string, relativeX: number) => editorTextIndexAtX(text, relativeX, layout),
    [layout],
  );

  const textIndexAtPoint = useCallback(
    (lineIndex: number, lineElement: HTMLButtonElement, clientX: number, clientY: number) => {
      const lineText = documentLines[lineIndex] || "";
      const renderedIndex = editorTextIndexFromPoint(lineElement, clientX, clientY, lineText);
      if (renderedIndex !== null) return renderedIndex;
      const rect = lineElement.getBoundingClientRect();
      return minTextLengthIndex(lineText, clientX - rect.left - layout.contentInsetX);
    },
    [documentLines, layout.contentInsetX, minTextLengthIndex],
  );

  const { isDraggingRef, handleLineMouseDown } = useEditorPointerSelection({
    containerRef,
    textareaRef,
    lineElementsRef,
    documentLines,
    totalLines,
    layout,
    selection,
    setSelection,
    setCursor,
    textIndexAtPoint,
    minTextLengthIndex,
    findWordBoundaries,
    onPointerStateChange: () => {
      setCompletions([]);
      dismissHover();
    },
  });
  isDraggingPointerRef.current = isDraggingRef.current;

  const { handleContextMenuOpenChange } = useEditorContextMenu({
    textareaRef,
    setHoverContextMenuOpen,
    clearCompletions: () => setCompletions([]),
    onExecuteAction: executeEditorAction,
  });

  return {
    getSelectionText,
    handleCut,
    handleCopy,
    executeEditorAction,
    textIndexAtPoint,
    isDraggingRef,
    handleLineMouseDown,
    handleContextMenuOpenChange,
  };
}
