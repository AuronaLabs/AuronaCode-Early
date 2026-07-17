import { describe, expect, it } from "vitest";
import { findWordBoundaries, normalizeEditorText, sortSelection } from "./EditorMath";

describe("EditorMath", () => {
  it("normalizes a reverse multi-line selection", () => {
    expect(
      sortSelection({
        start: { line: 3, char: 2 },
        end: { line: 1, char: 5 },
      }),
    ).toEqual({
      start: { line: 1, char: 5 },
      end: { line: 3, char: 2 },
    });
  });

  it("finds ASCII identifier boundaries without consuming punctuation", () => {
    expect(findWordBoundaries("hello.world", 8)).toEqual({ start: 6, end: 11 });
  });

  it("normalizes CRLF and lone carriage returns before insertion", () => {
    expect(normalizeEditorText("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });
});
