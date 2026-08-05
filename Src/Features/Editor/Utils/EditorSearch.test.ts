import { describe, expect, it } from "vitest";
import { advanceMatchIndex, findEditorMatches } from "../Hooks/useEditorSearch";

describe("findEditorMatches", () => {
  it("returns every occurrence across lines, case-insensitively", () => {
    const matches = findEditorMatches(["const foo = 1;", "const BAR = 2;", "foo(bar)", ""], "FOO");
    expect(matches).toEqual([
      { line: 0, char: 6 },
      { line: 2, char: 0 },
    ]);
  });

  it("returns no matches for an empty query", () => {
    expect(findEditorMatches(["abc"], "")).toEqual([]);
  });
});

describe("advanceMatchIndex", () => {
  it("wraps forward and backward within the match count", () => {
    expect(advanceMatchIndex(0, 3, 1)).toBe(1);
    expect(advanceMatchIndex(2, 3, 1)).toBe(0);
    expect(advanceMatchIndex(0, 3, -1)).toBe(2);
  });

  it("stays at zero when there are no matches", () => {
    expect(advanceMatchIndex(0, 0, 1)).toBe(0);
    expect(advanceMatchIndex(3, 0, -1)).toBe(0);
  });
});
