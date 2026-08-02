import { describe, expect, it } from "vitest";
import {
  affectedLineRange,
  duplicateLineRange,
  indentLineRange,
  moveLineRange,
  outdentLineRange,
  toggleLineComment,
} from "./EditorLineOperations";

describe("EditorLineOperations", () => {
  it("does not include the next line when a selection ends at column zero", () => {
    expect(
      affectedLineRange(0, {
        start: { line: 1, char: 2 },
        end: { line: 3, char: 0 },
      }),
    ).toEqual({ startLine: 1, endLine: 2 });
  });

  it("indents and outdents a complete range", () => {
    const indented = indentLineRange(["a", "b", "c"], { startLine: 0, endLine: 1 }, "  ");
    expect(indented).toEqual(["  a", "  b", "c"]);
    expect(outdentLineRange(indented, { startLine: 0, endLine: 1 }, 2).lines).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("toggles comments while preserving indentation", () => {
    const commented = toggleLineComment(["  value", "next"], { startLine: 0, endLine: 1 }, "//");
    expect(commented.lines).toEqual(["  // value", "// next"]);
    expect(toggleLineComment(commented.lines, { startLine: 0, endLine: 1 }, "//").lines).toEqual([
      "  value",
      "next",
    ]);
  });

  it("moves and duplicates line blocks without changing their order", () => {
    expect(moveLineRange(["a", "b", "c"], { startLine: 1, endLine: 1 }, -1).lines).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(duplicateLineRange(["a", "b"], { startLine: 0, endLine: 0 }).lines).toEqual([
      "a",
      "a",
      "b",
    ]);
  });
});
