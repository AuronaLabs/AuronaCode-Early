import { describe, expect, it } from "vitest";
import { type DocumentSymbolNode, flattenDocumentSymbols } from "./SymbolUtils";

describe("flattenDocumentSymbols", () => {
  it("flattens a symbol tree with hierarchy depth", () => {
    const tree: DocumentSymbolNode[] = [
      {
        name: "class Foo",
        range: { start: { line: 0 }, end: { line: 5 } },
        children: [
          {
            name: "method bar",
            range: { start: { line: 3 }, end: { line: 5 } },
            children: [{ name: "variable baz", range: { start: { line: 4 }, end: { line: 5 } } }],
          },
        ],
      },
    ];
    const flattened = flattenDocumentSymbols(tree);
    expect(flattened).toEqual([
      { name: "class Foo", line: 1, endLine: 6, depth: 0 },
      { name: "method bar", line: 4, endLine: 6, depth: 1 },
      { name: "variable baz", line: 5, endLine: 6, depth: 2 },
    ]);
  });

  it("skips unnamed nodes and keeps detail", () => {
    const flattened = flattenDocumentSymbols([
      { name: "", range: { start: { line: 0 } } },
      { name: "fn", detail: "function", range: { start: { line: 8 } } },
    ]);
    expect(flattened).toEqual([{ name: "fn", detail: "function", line: 9, depth: 0 }]);
  });
});
