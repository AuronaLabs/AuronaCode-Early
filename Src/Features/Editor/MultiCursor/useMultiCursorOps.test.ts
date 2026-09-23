import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MAX_EXTRA_CURSORS, useMultiCursorOps } from "./useMultiCursorOps";

/** 与 useEditorSelectionOps.findWordBoundaries 同判定的测试替身 */
const findWordBoundaries = (text: string, index: number) => {
  let start = index;
  let end = index;
  const wordCharRegex = /[a-zA-Z0-9_]/;
  while (start > 0 && wordCharRegex.test(text[start - 1])) start--;
  while (end < text.length && wordCharRegex.test(text[end])) end++;
  if (start === end && index < text.length) end = index + 1;
  return { start, end };
};

describe("useMultiCursorOps", () => {
  it("adds and clears extra cursors accurately", () => {
    const documentLines = ["const a = 1;", "const b = 2;"];
    const { result } = renderHook(() => useMultiCursorOps(documentLines));

    expect(result.current.extraCursors.length).toBe(0);

    act(() => {
      result.current.addCursor({ line: 1, char: 6 });
    });

    expect(result.current.extraCursors.length).toBe(1);
    expect(result.current.extraCursors[0]).toEqual({ line: 1, char: 6 });

    act(() => {
      result.current.clearExtraCursors();
    });

    expect(result.current.extraCursors.length).toBe(0);
  });

  it("Ctrl+D 词边界：跳过词中匹配（const 不命中 constant）", () => {
    const documentLines = ["const constant", "const x"];
    const { result } = renderHook(() => useMultiCursorOps(documentLines));

    // 主光标已选中第 0 行 [0,5) 的 "const"
    act(() => {
      result.current.selectNextOccurrence(
        { line: 0, char: 5 },
        { start: { line: 0, char: 0 }, end: { line: 0, char: 5 } },
        findWordBoundaries,
      );
    });

    // 第 0 行 char 6 的 "constant" 词中匹配被跳过；命中第 1 行整词 "const"
    expect(result.current.extraCursors.length).toBe(1);
    expect(result.current.extraCursors[0]).toEqual({ line: 1, char: 5 });
  });

  it("addCursorAtSelectionEnds：无选区时返回主光标行尾", () => {
    const documentLines = ["hello", "world"];
    const { result } = renderHook(() => useMultiCursorOps(documentLines));

    let target: { line: number; char: number } | null = null;
    act(() => {
      target = result.current.addCursorAtSelectionEnds({ line: 0, char: 2 }, null);
    });

    expect(target).toEqual({ line: 0, char: 5 });
    expect(result.current.extraCursors.length).toBe(0);
  });

  it("addCursorAtSelectionEnds：多选区在每个选区行尾加光标", () => {
    const documentLines = ["foo bar", "baz qux"];
    const { result } = renderHook(() => useMultiCursorOps(documentLines));

    // 主选区在第 0 行，副光标在第 1 行（Ctrl+D 后形态）
    act(() => {
      result.current.addCursor({ line: 1, char: 3 });
    });
    let target: { line: number; char: number } | null = null;
    act(() => {
      target = result.current.addCursorAtSelectionEnds(
        { line: 0, char: 3 },
        { start: { line: 0, char: 0 }, end: { line: 0, char: 3 } },
      );
    });

    // 主光标到第 0 行行尾；副光标到第 1 行行尾
    expect(target).toEqual({ line: 0, char: 7 });
    expect(result.current.extraCursors).toEqual([{ line: 1, char: 7 }]);
  });

  it("addColumnCursors：下方同列加光标，重复位置去重", () => {
    const documentLines = ["abc", "de", "f"];
    const { result } = renderHook(() => useMultiCursorOps(documentLines));

    act(() => {
      result.current.addColumnCursors({ line: 0, char: 2 }, 1);
    });
    // 列 2 超出下一行长度时收敛到行尾
    expect(result.current.extraCursors).toEqual([{ line: 1, char: 2 }]);

    act(() => {
      result.current.addColumnCursors({ line: 0, char: 2 }, 1);
    });
    // 主光标目标 {1,2} 已存在被去重；副光标 {1,2} 向下到 {2,1}（收敛到行尾）
    expect(result.current.extraCursors).toEqual([
      { line: 1, char: 2 },
      { line: 2, char: 1 },
    ]);

    act(() => {
      result.current.addColumnCursors({ line: 0, char: 2 }, 1);
    });
    // 全部目标重复或越界（{2,1} 已在最后一行）：不再新增
    expect(result.current.extraCursors).toEqual([
      { line: 1, char: 2 },
      { line: 2, char: 1 },
    ]);
  });

  it("addColumnCursors：到文档顶/底即停", () => {
    const documentLines = ["abc", "de"];
    const { result } = renderHook(() => useMultiCursorOps(documentLines));

    act(() => {
      result.current.addColumnCursors({ line: 0, char: 2 }, -1);
    });
    expect(result.current.extraCursors).toEqual([]);

    act(() => {
      result.current.addColumnCursors({ line: 1, char: 2 }, 1);
    });
    expect(result.current.extraCursors).toEqual([]);
  });

  it("addColumnCursors：受 MAX_EXTRA_CURSORS 上限约束", () => {
    const documentLines = Array.from({ length: MAX_EXTRA_CURSORS + 5 }, (_, i) => `line ${i}`);
    const { result } = renderHook(() => useMultiCursorOps(documentLines));

    // 逐行向下加列光标直到上限
    for (let i = 0; i < MAX_EXTRA_CURSORS + 10; i++) {
      act(() => {
        result.current.addColumnCursors({ line: 0, char: 0 }, 1);
      });
    }
    expect(result.current.extraCursors.length).toBe(MAX_EXTRA_CURSORS);
  });
});
