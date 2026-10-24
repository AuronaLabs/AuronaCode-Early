import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EDITOR_LAYOUT,
  editorTextIndexAtX,
  getGraphemeBoundaries,
  measureEditorText,
  nextGraphemeBoundary,
  previousGraphemeBoundary,
} from "./EditorLayoutMetrics";

describe("EditorLayoutMetrics", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (value: string) => ({
        width: [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
        ].reduce((width, item) => width + (item.segment === "中" ? 20 : 10), 0),
      }),
    } as CanvasRenderingContext2D);
  });
  afterAll(() => vi.restoreAllMocks());
  it("never places the caret inside an emoji surrogate pair", () => {
    const text = "a😀b";
    expect(editorTextIndexAtX(text, 14, DEFAULT_EDITOR_LAYOUT)).toBe(1);
    expect(editorTextIndexAtX(text, 16, DEFAULT_EDITOR_LAYOUT)).toBe(3);
  });
  it("measures shaped runs and advances tabs to configured stops", () => {
    const layout = { ...DEFAULT_EDITOR_LAYOUT, tabSize: 4 };
    expect(measureEditorText("e\u0301😀", layout)).toBe(20);
    expect(measureEditorText("a\tb", layout)).toBe(50);
    expect(measureEditorText("中\tb", layout)).toBe(50);
    expect(measureEditorText("abcd\t", layout)).toBe(80);
    expect(editorTextIndexAtX("中\tb", 29, layout)).toBe(1);
    expect(editorTextIndexAtX("中\tb", 31, layout)).toBe(2);
  });
  it("keeps combining marks and ZWJ sequences as indivisible editor positions", () => {
    const text = "e\u0301-\u{1F469}\u200D\u{1F4BB}";
    expect(getGraphemeBoundaries(text)).toEqual([0, 2, 3, text.length]);
    expect(previousGraphemeBoundary(text, text.length)).toBe(3);
    expect(nextGraphemeBoundary(text, 3)).toBe(text.length);
  });
});
