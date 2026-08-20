import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBracketMatching } from "./useBracketMatching";

describe("useBracketMatching", () => {
  it("matches nested brackets with correct rainbow levels", () => {
    const documentLines = ["function test() {", "  if (x[0]) {", "    return (1 + 2);", "  }", "}"];

    const { result } = renderHook(
      () => useBracketMatching(documentLines, { line: 0, char: 17 }), // 光标在第 0 行 '{'
    );

    expect(result.current.pairs.length).toBe(6);
    // 应该匹配到外层的 '{' 和 '}'
    expect(result.current.activeMatchedPair).toBeDefined();
    expect(result.current.activeMatchedPair?.open.line).toBe(0);
    expect(result.current.activeMatchedPair?.close.line).toBe(4);
  });
});
