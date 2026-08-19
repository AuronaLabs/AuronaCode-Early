import { useCallback } from "react";
import type { EditorAction } from "../../../Foundation/Types/Editor";

export interface UseEditorContextMenuOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setHoverContextMenuOpen: (open: boolean) => void;
  clearCompletions: () => void;
  undo: () => { content: string; cursor: { line: number; char: number } } | null;
  redo: () => { content: string; cursor: { line: number; char: number } } | null;
  applyHistoryState: (state: { content: string; cursor: { line: number; char: number } }) => void;
  onExecuteAction: (action: EditorAction) => void;
}

/**
 * 封装编辑器右键菜单状态与常见操作分发
 */
export function useEditorContextMenu({
  textareaRef,
  setHoverContextMenuOpen,
  clearCompletions,
  undo,
  redo,
  applyHistoryState,
  onExecuteAction,
}: UseEditorContextMenuOptions) {
  const handleContextMenuOpenChange = useCallback(
    (open: boolean) => {
      setHoverContextMenuOpen(open);
      if (open) {
        clearCompletions();
        return;
      }
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [clearCompletions, setHoverContextMenuOpen, textareaRef],
  );

  const handleUndo = useCallback(() => {
    const prev = undo();
    if (prev) {
      applyHistoryState(prev);
    }
  }, [applyHistoryState, undo]);

  const handleRedo = useCallback(() => {
    const next = redo();
    if (next) {
      applyHistoryState(next);
    }
  }, [applyHistoryState, redo]);

  return {
    handleContextMenuOpenChange,
    handleUndo,
    handleRedo,
    executeEditorAction: onExecuteAction,
  };
}
