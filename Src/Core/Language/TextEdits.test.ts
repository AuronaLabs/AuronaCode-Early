import { applyLspTextEdits, positionToUtf16Offset } from "./TextEdits";

describe("LSP text edits", () => {
  it("uses UTF-16 positions for emoji and Chinese text", () => {
    const content = "😀中文\nvalue";
    expect(positionToUtf16Offset(content, { line: 0, character: 2 })).toBe(2);
    expect(positionToUtf16Offset(content, { line: 1, character: 2 })).toBe(7);
  });

  it("applies multiple edits from the end of the document", () => {
    const result = applyLspTextEdits("one\ntwo\nthree", [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        newText: "ONE",
      },
      {
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
        newText: "THREE",
      },
    ]);
    expect(result.content).toBe("ONE\ntwo\nTHREE");
    expect(result.documentEdits[0].startUtf16).toBeGreaterThan(result.documentEdits[1].startUtf16);
  });

  it("rejects overlapping edits", () => {
    expect(() =>
      applyLspTextEdits("abcdef", [
        {
          range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
          newText: "x",
        },
        {
          range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } },
          newText: "y",
        },
      ]),
    ).toThrow(/overlapping/);
  });
});
