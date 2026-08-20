import { describe, expect, it } from "vitest";
import { FoldingLineMap } from "./FoldingLineMap";

describe("FoldingLineMap", () => {
  it("maps real lines to visible lines correctly when folded", () => {
    // 假设 10 行文档，折叠第 2 行到第 5 行 (隐藏 3, 4, 5)
    const map = new FoldingLineMap(10, [{ startLine: 2, endLine: 5 }]);

    // 总共隐藏了 3 行，剩余 7 行可视
    expect(map.visibleLineCount).toBe(7);

    // 真实行 0, 1, 2 分别对应可视行 0, 1, 2
    expect(map.getVisibleLine(0)).toBe(0);
    expect(map.getVisibleLine(1)).toBe(1);
    expect(map.getVisibleLine(2)).toBe(2);

    // 真实行 3, 4, 5 被隐藏，回溯到第 2 行的可视行 2
    expect(map.getVisibleLine(3)).toBe(2);
    expect(map.getVisibleLine(4)).toBe(2);
    expect(map.getVisibleLine(5)).toBe(2);

    // 真实行 6 对应可视行 3
    expect(map.getVisibleLine(6)).toBe(3);

    // 反查：可视行 3 对应真实行 6
    expect(map.getRealLine(3)).toBe(6);
  });
});
