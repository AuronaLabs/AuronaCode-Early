import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMinimapRenderer } from "./useMinimapRenderer";

describe("useMinimapRenderer", () => {
  it("calculates slider height and top position proportionally", () => {
    const onScrollTo = vi.fn();
    const documentLines = new Array(100).fill("const a = 1;");

    const { result } = renderHook(() =>
      useMinimapRenderer({
        documentLines,
        linesTokens: [],
        totalLines: 100,
        scrollTop: 240, // 相当于 10 行
        viewportHeight: 480, // 相当于 20 行
        lineHeight: 24, // 总高 2400px
        minimapWidth: 64,
        decorations: [],
        onScrollTo,
      }),
    );

    // minimapContentHeight = 100 * 2 = 200px
    // totalContentHeight = 2400px
    // sliderHeight = (480 / 2400) * 200 = 40px
    expect(result.current.sliderHeight).toBe(40);
    // sliderTop = (240 / 2400) * 200 = 20px
    expect(result.current.sliderTop).toBe(20);
  });
});
