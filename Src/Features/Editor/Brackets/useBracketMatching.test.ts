import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  BRACKET_SCAN_WINDOW_LINES,
  findMatchedPairNearCursor,
  useBracketMatching,
} from "./useBracketMatching";

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

  it("局部扫描：窗口内括号正确配对（光标在闭括号上）", () => {
    const documentLines = ["{", "  (a)", "}"];
    // 光标在第 2 行 '}' 左侧
    const pair = findMatchedPairNearCursor(documentLines, { line: 2, char: 1 });
    expect(pair).not.toBeNull();
    expect(pair?.open).toMatchObject({ line: 0, char: 0, type: "{" });
    expect(pair?.close).toMatchObject({ line: 2, char: 0, type: "}" });
  });

  it("局部扫描：括号超出窗口范围时返回 null", () => {
    const padding = Array.from({ length: BRACKET_SCAN_WINDOW_LINES + 10 }, () => "plain");
    const documentLines = ["{", ...padding, "}"];
    // 光标在最后一行 '}' 上：配对的 '{' 在窗口（向上 500 行）之外
    const pair = findMatchedPairNearCursor(documentLines, {
      line: documentLines.length - 1,
      char: 1,
    });
    expect(pair).toBeNull();
  });

  it("局部扫描：光标不在括号附近时返回 null", () => {
    const documentLines = ["const a = (1 + 2);"];
    expect(findMatchedPairNearCursor(documentLines, { line: 0, char: 4 })).toBeNull();
  });
});
