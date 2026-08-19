import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorContextMenu } from "./useEditorContextMenu";

describe("useEditorContextMenu", () => {
  it("coordinates menu open state and triggers undo / redo", () => {
    const textarea = document.createElement("textarea");
    const textareaRef = { current: textarea };
    const setHoverContextMenuOpen = vi.fn();
    const clearCompletions = vi.fn();
    const undo = vi.fn(() => ({
      content: "line 1",
      cursor: { line: 0, char: 6 },
    }));
    const redo = vi.fn(() => ({
      content: "line 1 modified",
      cursor: { line: 0, char: 15 },
    }));
    const applyHistoryState = vi.fn();
    const onExecuteAction = vi.fn();

    const { result } = renderHook(() =>
      useEditorContextMenu({
        textareaRef,
        setHoverContextMenuOpen,
        clearCompletions,
        undo,
        redo,
        applyHistoryState,
        onExecuteAction,
      }),
    );

    act(() => {
      result.current.handleContextMenuOpenChange(true);
    });
    expect(setHoverContextMenuOpen).toHaveBeenCalledWith(true);
    expect(clearCompletions).toHaveBeenCalled();

    act(() => {
      result.current.handleUndo();
    });
    expect(undo).toHaveBeenCalled();
    expect(applyHistoryState).toHaveBeenCalledWith({
      content: "line 1",
      cursor: { line: 0, char: 6 },
    });

    act(() => {
      result.current.handleRedo();
    });
    expect(redo).toHaveBeenCalled();
    expect(applyHistoryState).toHaveBeenCalledWith({
      content: "line 1 modified",
      cursor: { line: 0, char: 15 },
    });

    act(() => {
      result.current.executeEditorAction("copy");
    });
    expect(onExecuteAction).toHaveBeenCalledWith("copy");
  });
});
