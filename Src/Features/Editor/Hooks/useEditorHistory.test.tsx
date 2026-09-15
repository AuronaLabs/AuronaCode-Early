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

  it("连续撤销可回到初始内容且栈空后返回 null", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result } = renderHook(() => useEditorHistory("hello"));

    act(() => result.current.pushHistory("hello world", 11));
    vi.setSystemTime(1_600);
    act(() => result.current.pushHistory("hello world!", 12));

    expect(result.current.undo()?.content).toBe("hello world");
    expect(result.current.undo()?.content).toBe("hello");
    expect(result.current.undo()).toBeNull();
  });

  it("撤销后重做可恢复内容，重做到栈顶后返回 null", () => {
    const { result } = renderHook(() => useEditorHistory("a"));

    act(() => result.current.pushHistory("ab", 2));
    act(() => result.current.pushHistory("abc", 3));
    act(() => result.current.undo());

    expect(result.current.redo()?.content).toBe("abc");
    expect(result.current.redo()).toBeNull();
  });

  it("受控回传内容与栈顶一致时保留撤销栈", () => {
    const { result } = renderHook(() => useEditorHistory("hello"));

    act(() => result.current.pushHistory("hello world", 11));

    act(() => result.current.syncExternal("hello world"));
    expect(result.current.undo()?.content).toBe("hello");
  });

  it("真实外部内容变更时重置撤销栈", () => {
    const { result } = renderHook(() => useEditorHistory("hello"));

    act(() => result.current.pushHistory("hello world", 11));

    act(() => result.current.syncExternal("externally changed"));
    expect(result.current.undo()).toBeNull();
  });

  it("composite 操作一步撤销全部子操作，重做顺序回放", () => {
    const { result } = renderHook(() => useEditorHistory("abcdef"));
    // 两个降序子操作：删除 [3,6) "def"，删除 [0,2) "ab"（提交时内存内容已变为 "c"）
    act(() => {
      result.current.pushComposite(
        [
          { startUtf16: 3, deletedText: "def", insertedText: "" },
          { startUtf16: 0, deletedText: "ab", insertedText: "" },
        ],
        1,
        "c",
      );
    });

    // 一步撤销（逆序回放）：先恢复 "ab" 得 "abc"，再恢复 "def" 得 "abcdef"
    expect(result.current.undo()?.content).toBe("abcdef");
    // 重做（顺序回放）：先删 "def" 得 "abc"，再删 "ab" 得 "c"
    expect(result.current.redo()?.content).toBe("c");
    expect(result.current.redo()).toBeNull();
  });

  it("composite 不会与相邻打字合并", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result } = renderHook(() => useEditorHistory(""));

    act(() => {
      result.current.pushComposite([{ startUtf16: 0, deletedText: "", insertedText: "x" }], 1, "x");
    });
    act(() => result.current.pushHistory("xy", 2));

    // composite 之后的打字不并入 composite：撤销打字得到 "x"
    expect(result.current.undo()?.content).toBe("x");
    // composite 自身单独一步
    expect(result.current.undo()?.content).toBe("");
  });
});
