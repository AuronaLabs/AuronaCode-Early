import { describe, expect, it } from "vitest";
import {
  advanceMatchIndex,
  buildSearchRegex,
  defaultSearchOptions,
  expandRegexReplacement,
  findEditorMatches,
  resolveLineReplacement,
} from "../Hooks/useEditorSearch";

describe("findEditorMatches", () => {
  it("returns every occurrence across lines, case-insensitively by default", () => {
    const matches = findEditorMatches(["const foo = 1;", "const BAR = 2;", "foo(bar)", ""], "FOO");
    expect(matches).toEqual([
      { line: 0, char: 6, length: 3 },
      { line: 2, char: 0, length: 3 },
    ]);
  });

  it("returns no matches for an empty query", () => {
    expect(findEditorMatches(["abc"], "")).toEqual([]);
  });

  it("honors matchCase when enabled", () => {
    const lines = ["foo FOO Foo"];
    const insensitive = findEditorMatches(lines, "foo", {
      ...defaultSearchOptions,
      matchCase: false,
    });
    const sensitive = findEditorMatches(lines, "foo", { ...defaultSearchOptions, matchCase: true });
    expect(insensitive).toHaveLength(3);
    expect(sensitive).toEqual([{ line: 0, char: 0, length: 3 }]);
  });

  it("supports regular expressions with variable match lengths", () => {
    const options = { ...defaultSearchOptions, useRegex: true };
    const matches = findEditorMatches(["x abc y a1 z"], "a\\w+", options);
    expect(matches).toEqual([
      { line: 0, char: 2, length: 3 },
      { line: 0, char: 8, length: 2 },
    ]);
  });

  it("matches whole words only when enabled", () => {
    const lines = ["cat catalog concatenate cat"];
    const matches = findEditorMatches(lines, "cat", { ...defaultSearchOptions, wholeWord: true });
    expect(matches).toEqual([
      { line: 0, char: 0, length: 3 },
      { line: 0, char: 24, length: 3 },
    ]);
  });

  it("returns an empty list for an invalid regex instead of throwing", () => {
    const options = { ...defaultSearchOptions, useRegex: true };
    expect(findEditorMatches(["abc"], "a(", options)).toEqual([]);
    expect(buildSearchRegex("a(", options)).toBeNull();
  });

  it("escapes literal metacharacters when regex mode is off", () => {
    const matches = findEditorMatches(["a.c abc"], "a.c");
    expect(matches).toEqual([{ line: 0, char: 0, length: 3 }]);
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

describe("expandRegexReplacement", () => {
  const execAt = (pattern: string, text: string, flags = "gu") => {
    const regex = new RegExp(pattern, flags);
    return regex.exec(text) as RegExpExecArray;
  };

  it("returns the literal value unchanged when regex mode is off", () => {
    const hit = execAt("(foo)", "foo bar");
    expect(expandRegexReplacement("$1 $&", hit, false)).toBe("$1 $&");
  });

  it("expands capture groups, whole match and escaped dollar", () => {
    const hit = execAt("(\\w+)@(\\w+)", "user@host");
    expect(expandRegexReplacement("$2.$1", hit, true)).toBe("host.user");
    expect(expandRegexReplacement("[$&]", hit, true)).toBe("[user@host]");
    expect(expandRegexReplacement("$$1", hit, true)).toBe("$1");
  });

  it("keeps invalid group tokens and empty groups as-is", () => {
    const hit = execAt("(foo)", "foo");
    expect(expandRegexReplacement("$9", hit, true)).toBe("$9");
    expect(expandRegexReplacement("$0", hit, true)).toBe("$0");
  });
});

describe("resolveLineReplacement", () => {
  it("uses the raw value in literal mode", () => {
    const replacement = resolveLineReplacement(
      "foo bar",
      { line: 0, char: 0, length: 3 },
      "foo",
      "$1",
      defaultSearchOptions,
    );
    expect(replacement).toBe("$1");
  });

  it("expands groups per match in regex mode", () => {
    const options = { ...defaultSearchOptions, useRegex: true };
    expect(
      resolveLineReplacement("user@host", { line: 0, char: 0, length: 9 }, "(\\w+)@(\\w+)", "$2.$1", options),
    ).toBe("host.user");
    // 同行第二个命中按其自身内容展开
    expect(
      resolveLineReplacement("a@b c@d", { line: 0, char: 4, length: 3 }, "(\\w+)@(\\w+)", "$2-$1", options),
    ).toBe("d-c");
  });
});
