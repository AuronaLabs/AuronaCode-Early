import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EDITOR_LAYOUT,
  editorTextIndexAtX,
  getGraphemeBoundaries,
  nextGraphemeBoundary,
  previousGraphemeBoundary,
} from "./EditorLayoutMetrics";

describe("EditorLayoutMetrics", () => {
  it("never places the caret inside an emoji surrogate pair", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (value: string) => ({ width: [...value].length * 10 }),
    } as CanvasRenderingContext2D);

    const text = "a😀b";
    expect(editorTextIndexAtX(text, 14, DEFAULT_EDITOR_LAYOUT)).toBe(1);
    expect(editorTextIndexAtX(text, 16, DEFAULT_EDITOR_LAYOUT)).toBe(3);
  });
  it("keeps combining marks and ZWJ sequences as indivisible editor positions", () => {
    const text = "e\u0301-\u{1F469}\u200D\u{1F4BB}";
    expect(getGraphemeBoundaries(text)).toEqual([0, 2, 3, text.length]);
    expect(previousGraphemeBoundary(text, text.length)).toBe(3);
    expect(nextGraphemeBoundary(text, 3)).toBe(text.length);
  });
});
