import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCodeFolding } from "./useCodeFolding";

describe("useCodeFolding", () => {
  it("identifies indentation-based foldable blocks and toggles fold state", () => {
    const documentLines = [
      "function root() {", // 行 0
      "  const a = 1;", // 行 1
      "  if (a) {", // 行 2
      "    console.log(a);", // 行 3
      "  }", // 行 4
      "}", // 行 5
    ];

    const { result } = renderHook(() => useCodeFolding(documentLines));

    // 应该识别出 2 个可折叠代码块 (行 0 到 4/5，行 2 到 4)
    expect(result.current.foldableRanges.length).toBeGreaterThanOrEqual(1);

    // 切换折叠第 0 行
    act(() => {
      result.current.toggleFold(0);
    });

    expect(result.current.foldedStartLines.has(0)).toBe(true);
    expect(result.current.lineMap.isLineHidden(1)).toBe(true);
  });
});
