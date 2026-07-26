import { describe, expect, it } from "vitest";
import {
  diagnosticsForLine,
  findWordBoundaries,
  normalizeEditorText,
  segmentLine,
  sortSelection,
} from "./EditorMath";

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

  it("projects a multi-line diagnostic onto every affected editor line", () => {
    const diagnostic = {
      range: {
        start: { line: 1, character: 3 },
        end: { line: 3, character: 2 },
      },
      severity: 1,
      message: "broken expression",
    };

    expect(diagnosticsForLine([diagnostic], 2, 8)[0].range).toEqual({
      start: { line: 2, character: 0 },
      end: { line: 2, character: 8 },
    });
  });

  it("expands an empty diagnostic range so the wave remains visible", () => {
    const diagnostics = [
      {
        range: {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 3 },
        },
        severity: 1,
        message: "missing token",
      },
    ];

    expect(segmentLine("value", [], "", [], -1, [], 0, diagnostics)).toContainEqual({
      start: 3,
      end: 4,
      classes: ["hl-diag-error"],
    });
  });
});
