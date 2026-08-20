import { describe, expect, it } from "vitest";
import {
  getCursorFromUtf16Offset,
  getLineStartUtf16,
  getLinesAfterDeletion,
} from "./useEditorSelectionOps";

describe("useEditorSelectionOps helpers", () => {
  it("computes line start UTF-16 offset correctly", () => {
    const lines = ["hello", "world", "aurona"];
    expect(getLineStartUtf16(lines, 0)).toBe(0);
    expect(getLineStartUtf16(lines, 1)).toBe(6); // "hello\n"
    expect(getLineStartUtf16(lines, 2)).toBe(12); // "hello\nworld\n"
  });

  it("converts UTF-16 offset to line and character position", () => {
    const lines = ["const a = 1;", "const b = 2;"];
    expect(getCursorFromUtf16Offset(lines, 0)).toEqual({ line: 0, char: 0 });
    expect(getCursorFromUtf16Offset(lines, 6)).toEqual({ line: 0, char: 6 });
    expect(getCursorFromUtf16Offset(lines, 13)).toEqual({ line: 1, char: 0 });
    expect(getCursorFromUtf16Offset(lines, 18)).toEqual({ line: 1, char: 5 });
  });

  it("deletes single-line selection accurately", () => {
    const lines = ["hello beautiful world"];
    const selection = {
      start: { line: 0, char: 6 },
      end: { line: 0, char: 16 },
    };
    const result = getLinesAfterDeletion(lines, selection);
    expect(result.lines).toEqual(["hello world"]);
    expect(result.cursor).toEqual({ line: 0, char: 6 });
  });

  it("deletes multi-line selection accurately", () => {
    const lines = ["function test() {", "  console.log(1);", "  return true;", "}"];
    const selection = {
      start: { line: 0, char: 17 },
      end: { line: 3, char: 0 },
    };
    const result = getLinesAfterDeletion(lines, selection);
    expect(result.lines).toEqual(["function test() {}"]);
    expect(result.cursor).toEqual({ line: 0, char: 17 });
  });
});
