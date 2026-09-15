import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorContextMenu } from "./useEditorContextMenu";

describe("useEditorContextMenu", () => {
  it("coordinates menu open state and forwards editor actions", () => {
    const textarea = document.createElement("textarea");
    const textareaRef = { current: textarea };
    const setHoverContextMenuOpen = vi.fn();
    const clearCompletions = vi.fn();
    const onExecuteAction = vi.fn();

    const { result } = renderHook(() =>
      useEditorContextMenu({
        textareaRef,
        setHoverContextMenuOpen,
        clearCompletions,
        onExecuteAction,
      }),
    );

    act(() => {
      result.current.handleContextMenuOpenChange(true);
    });
    expect(setHoverContextMenuOpen).toHaveBeenCalledWith(true);
    expect(clearCompletions).toHaveBeenCalled();

    act(() => {
      result.current.executeEditorAction("copy");
    });
    expect(onExecuteAction).toHaveBeenCalledWith("copy");
  });

  it("clears completions when the menu opens", () => {
    const textarea = document.createElement("textarea");
    const textareaRef = { current: textarea };
    const setHoverContextMenuOpen = vi.fn();
    const clearCompletions = vi.fn();
    const onExecuteAction = vi.fn();

    const { result } = renderHook(() =>
      useEditorContextMenu({
        textareaRef,
        setHoverContextMenuOpen,
        clearCompletions,
        onExecuteAction,
      }),
    );

    act(() => {
      result.current.handleContextMenuOpenChange(false);
    });
    expect(setHoverContextMenuOpen).toHaveBeenCalledWith(false);
    expect(clearCompletions).not.toHaveBeenCalled();
  });
});
