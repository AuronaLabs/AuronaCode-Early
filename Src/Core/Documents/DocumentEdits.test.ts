import { prepareDocumentEdits } from "./DocumentEdits";

describe("snapshot document edits", () => {
  it("preserves CRLF and interprets emoji columns as UTF-16", () => {
    const result = prepareDocumentEdits("a😀\r\nlast", [
      { range: { startLine: 1, startColumn: 2, endLine: 1, endColumn: 4 }, newText: "X" },
    ]);
    expect(result.content).toBe("aX\r\nlast");
    expect(result.edits).toEqual([{ startUtf16: 1, endUtf16: 3, text: "X" }]);
  });
  it("can replace multiple old lines with one line without leaving a tail", () => {
    expect(
      prepareDocumentEdits("one\ntwo\nthree", [
        { range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 6 }, newText: "new" },
      ]).content,
    ).toBe("new");
  });
  it("applies distinct edits against a single original snapshot", () => {
    expect(
      prepareDocumentEdits("abcdef", [
        { range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }, newText: "START" },
        { range: { startLine: 1, startColumn: 6, endLine: 1, endColumn: 7 }, newText: "END" },
      ]).content,
    ).toBe("STARTbcdeEND");
  });
  it("rejects invalid, reversed and overlapping ranges", () => {
    for (const range of [
      { startLine: 0, startColumn: 1, endLine: 1, endColumn: 1 },
      { startLine: 1, startColumn: 99, endLine: 1, endColumn: 99 },
      { startLine: 1, startColumn: 3, endLine: 1, endColumn: 1 },
    ])
      expect(() => prepareDocumentEdits("abc", [{ range, newText: "" }])).toThrow("editor.range");
    expect(() =>
      prepareDocumentEdits("abc", [
        { range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 3 }, newText: "" },
        { range: { startLine: 1, startColumn: 2, endLine: 1, endColumn: 4 }, newText: "" },
      ]),
    ).toThrow("overlap");
  });
});
