import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_LAYOUT } from "../Utils/EditorLayoutMetrics";
import {
  calculateGutterDigitCount,
  calculateGutterWidth,
  useEditorGutterMetrics,
} from "./useEditorGutterMetrics";

describe("useEditorGutterMetrics", () => {
  it("calculates digit count correctly", () => {
    expect(calculateGutterDigitCount(1)).toBe(2);
    expect(calculateGutterDigitCount(99)).toBe(2);
    expect(calculateGutterDigitCount(100)).toBe(3);
    expect(calculateGutterDigitCount(9999)).toBe(4);
    expect(calculateGutterDigitCount(100000)).toBe(6);
  });

  it("calculates gutter width with character width and padding", () => {
    const charWidth = 8;
    const width = calculateGutterWidth(100, charWidth, 16);
    // 3 digits * 8 + 16 = 40
    expect(width).toBe(40);
  });

  it("gutter 宽度随行数位数增长（六位数行号）", () => {
    const charWidth = 8;
    // 6 digits * 8 + 16 = 64
    expect(calculateGutterWidth(123456, charWidth, 16)).toBe(64);
    // 位数不变时宽度稳定（999999 与 100000 同为 6 位）
    expect(calculateGutterWidth(999999, charWidth, 16)).toBe(64);
  });

  it("hook computes correct offsets and formatting", () => {
    const { result } = renderHook(() =>
      useEditorGutterMetrics({
        totalLines: 150,
        visibleStartIndex: 10,
        layout: {
          ...DEFAULT_EDITOR_LAYOUT,
          lineHeight: 20,
          contentInsetTop: 8,
        },
      }),
    );

    expect(result.current.digitCount).toBe(3);
    expect(result.current.gutterOffsetY).toBe(8 + 10 * 20);
    expect(result.current.formatLineNumber(0)).toBe("1");
    expect(result.current.formatLineNumber(9)).toBe("10");
  });
});
