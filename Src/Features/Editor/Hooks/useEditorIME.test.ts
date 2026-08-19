import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorIME } from "./useEditorIME";

describe("useEditorIME", () => {
  it("manages composition lifecycle and commits text on end", () => {
    const onCommitText = vi.fn();
    const textarea = document.createElement("textarea");
    const textareaRef = { current: textarea };

    const { result } = renderHook(() =>
      useEditorIME({
        textareaRef,
        onCommitText,
      }),
    );

    expect(result.current.isComposing).toBe(false);
    expect(result.current.compositionText).toBe("");

    act(() => {
      result.current.handleCompositionStart();
    });
    expect(result.current.isComposing).toBe(true);

    act(() => {
      result.current.handleCompositionUpdate({
        data: "nihao",
      } as React.CompositionEvent<HTMLTextAreaElement>);
    });
    expect(result.current.compositionText).toBe("nihao");

    act(() => {
      result.current.handleCompositionEnd({
        data: "你好",
      } as React.CompositionEvent<HTMLTextAreaElement>);
    });

    expect(result.current.isComposing).toBe(false);
    expect(result.current.compositionText).toBe("");
    expect(onCommitText).toHaveBeenCalledWith("你好");
  });

  it("resets composition state cleanly", () => {
    const onCommitText = vi.fn();
    const textarea = document.createElement("textarea");
    textarea.value = "staging";
    const textareaRef = { current: textarea };

    const { result } = renderHook(() =>
      useEditorIME({
        textareaRef,
        onCommitText,
      }),
    );

    act(() => {
      result.current.handleCompositionStart();
    });
    expect(result.current.isComposing).toBe(true);

    act(() => {
      result.current.resetComposition();
    });

    expect(result.current.isComposing).toBe(false);
    expect(result.current.compositionText).toBe("");
    expect(textarea.value).toBe("");
    expect(onCommitText).not.toHaveBeenCalled();
  });
});
