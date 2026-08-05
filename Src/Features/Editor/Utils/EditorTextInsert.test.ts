import { describe, expect, it } from "vitest";
import { insertTextIntoLines } from "./EditorTextInsert";

describe("insertTextIntoLines", () => {
  it("inserts text on the same line and advances the caret", () => {
    const result = insertTextIntoLines(["ab", "cd"], { line: 0, char: 1 }, "XY");
    expect(result.lines).toEqual(["aXYb", "cd"]);
    expect(result.cursor).toEqual({ line: 0, char: 3 });
  });

  it("splits multiple inserted lines and positions the caret at the end", () => {
    const result = insertTextIntoLines(["ab", "cd"], { line: 1, char: 1 }, "X\nYZ");
    expect(result.lines).toEqual(["ab", "cX", "YZd"]);
    expect(result.cursor).toEqual({ line: 2, char: 2 });
  });

  it("handles insertion at the end of a line", () => {
    const result = insertTextIntoLines(["ab"], { line: 0, char: 2 }, "!").lines;
    expect(result).toEqual(["ab!"]);
  });

  it("does not mutate the input lines", () => {
    const input = ["ab"];
    insertTextIntoLines(input, { line: 0, char: 0 }, "X");
    expect(input).toEqual(["ab"]);
  });
});
