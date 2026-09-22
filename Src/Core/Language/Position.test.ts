import { describe, expect, it } from "vitest";
import {
  lspColumnToUtf16,
  normalizePositionEncoding,
  positionForEncoding,
  utf16ColumnToLsp,
  utf16OffsetToPosition,
} from "./Position";

describe("LSP position encoding", () => {
  it("preserves JavaScript UTF-16 columns including surrogate pairs", () => {
    const line = "a中😀b";
    expect(utf16ColumnToLsp(line, 4, "utf-16")).toBe(4);
    expect(lspColumnToUtf16(line, 4, "utf-16")).toBe(4);
  });

  it("converts Chinese and emoji between UTF-16 columns and UTF-8 bytes", () => {
    const line = "a中😀b";
    expect(utf16ColumnToLsp(line, 1, "utf-8")).toBe(1);
    expect(utf16ColumnToLsp(line, 2, "utf-8")).toBe(4);
    expect(utf16ColumnToLsp(line, 4, "utf-8")).toBe(8);
    expect(lspColumnToUtf16(line, 8, "utf-8")).toBe(4);
  });

  it("handles CRLF lines and defaults unknown encodings to UTF-16", () => {
    expect(positionForEncoding("one\r\n中😀", { line: 1, character: 3 }, "utf-8")).toEqual({
      line: 1,
      character: 7,
    });
    expect(normalizePositionEncoding("UTF-8")).toBe("utf-8");
    expect(normalizePositionEncoding("utf-32")).toBe("utf-16");
  });

  it("maps absolute UTF-16 offsets to line/character across LF and CRLF", () => {
    const text = "ab\ncd\r\nef";
    expect(utf16OffsetToPosition(text, 0)).toEqual({ line: 0, character: 0 });
    expect(utf16OffsetToPosition(text, 3)).toEqual({ line: 1, character: 0 });
    // CRLF 占两个 UTF-16 码元：\r 所在行内列、\n 后进入下一行行首
    expect(utf16OffsetToPosition(text, 5)).toEqual({ line: 1, character: 2 });
    expect(utf16OffsetToPosition(text, 7)).toEqual({ line: 2, character: 0 });
    expect(utf16OffsetToPosition(text, 9)).toEqual({ line: 2, character: 2 });
    // 越界钳制
    expect(utf16OffsetToPosition(text, 99)).toEqual({ line: 2, character: 2 });
    expect(utf16OffsetToPosition(text, -1)).toEqual({ line: 0, character: 0 });
  });
});
