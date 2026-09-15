import { useCallback } from "react";
import type { EditorAction } from "../../../Foundation/Types/Editor";

export interface UseEditorContextMenuOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setHoverContextMenuOpen: (open: boolean) => void;
  clearCompletions: () => void;
  onExecuteAction: (action: EditorAction) => void;
}

/**
 * 封装编辑器右键菜单状态与常见操作分发。
 * 撤销/重做统一走 onExecuteAction（引擎 handleUndo/handleRedo 已接撤销栈）。
 */
export function useEditorContextMenu({
  textareaRef,
  setHoverContextMenuOpen,
  clearCompletions,
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

  return {
    handleContextMenuOpenChange,
    executeEditorAction: onExecuteAction,
  };
}
