import { describe, expect, it } from "vitest";
import { cursorOffsetAfterBatchEdits } from "./useEditorCommit";

describe("multi-cursor position mapping", () => {
  it("includes earlier insertions in later cursor positions", () => {
    const edits = [
      { startUtf16: 0, endUtf16: 0, text: "!" },
      { startUtf16: 4, endUtf16: 4, text: "XY" },
    ];
    expect(cursorOffsetAfterBatchEdits(0, edits, { startUtf16: 0, cursorOffsetInText: 1 })).toBe(1);
    expect(cursorOffsetAfterBatchEdits(4, edits, { startUtf16: 4, cursorOffsetInText: 2 })).toBe(7);
  });

  it("accounts for earlier deletions and multiline replacements", () => {
    const edits = [
      { startUtf16: 1, endUtf16: 4, text: "" },
      { startUtf16: 7, endUtf16: 9, text: "\nnext\n" },
    ];
    expect(cursorOffsetAfterBatchEdits(7, edits, { startUtf16: 7, cursorOffsetInText: 6 })).toBe(
      10,
    );
    expect(cursorOffsetAfterBatchEdits(12, edits)).toBe(13);
  });

  it("keeps a skipped overlapping cursor inside the replacement", () => {
    const edits = [{ startUtf16: 2, endUtf16: 6, text: "XY" }];
    expect(cursorOffsetAfterBatchEdits(4, edits)).toBe(4);
    expect(cursorOffsetAfterBatchEdits(6, edits)).toBe(4);
  });
});
