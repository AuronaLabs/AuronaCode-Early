import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorHistory } from "./useEditorHistory";

describe("useEditorHistory", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("将 500ms 内的连续输入合并为一次撤销", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result } = renderHook(() => useEditorHistory(""));

    act(() => result.current.pushHistory("a", 1));
    vi.setSystemTime(1_300);
    act(() => result.current.pushHistory("ab", 2));

    expect(result.current.undo()).toEqual({ content: "", selectionStart: 0 });
    expect(result.current.redo()).toEqual({ content: "ab", selectionStart: 2 });
  });

  it("不合并超出时间窗口的输入", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result } = renderHook(() => useEditorHistory(""));

    act(() => result.current.pushHistory("a", 1));
    vi.setSystemTime(1_501);
    act(() => result.current.pushHistory("ab", 2));

    expect(result.current.undo()).toEqual({ content: "a", selectionStart: 1 });
  });

  it("在替换代理对字符后可无损撤销", () => {
    const { result } = renderHook(() => useEditorHistory("A😀B"));

    act(() => result.current.pushHistory("A🙂B", 3));

    expect(result.current.undo()?.content).toBe("A😀B");
  });
});
