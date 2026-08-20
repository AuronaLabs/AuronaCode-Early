import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_LAYOUT } from "../Utils/EditorLayoutMetrics";
import { useEditorViewport } from "./useEditorViewport";

describe("useEditorViewport", () => {
  it("calculates visible range and gutter offset accurately with overscan", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", { value: 480, configurable: true });
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useEditorViewport({
        totalLines: 1000,
        layout: DEFAULT_EDITOR_LAYOUT, // lineHeight: 24
        containerRef,
        overscan: 5,
      }),
    );

    // 初始 scrollTop = 0，visibleStartIndex 应该为 0
    expect(result.current.visibleStartIndex).toBe(0);
    // 480 / 24 = 20 行，加上 overscan 5 -> 25
    expect(result.current.visibleEndIndex).toBe(25);
    expect(result.current.gutterOffsetY).toBe(0);
  });
});
