export interface DocumentSymbolNode {
  name?: string;
  detail?: string;
  kind?: number;
  range?: { start: { line: number }; end?: { line: number } };
  children?: DocumentSymbolNode[];
}

export interface FlattenedSymbol {
  name: string;
  detail?: string;
  kind?: number;
  line: number;
  endLine?: number;
  depth: number;
}

export function flattenDocumentSymbols(
  nodes: readonly DocumentSymbolNode[],
  depth = 0,
  output: FlattenedSymbol[] = [],
): FlattenedSymbol[] {
  for (const node of nodes) {
    const name = node.name?.trim();
    if (name) {
      output.push({
        name,
        detail: node.detail?.trim() || undefined,
        kind: node.kind,
        line: node.range ? node.range.start.line + 1 : 1,
        endLine: node.range?.end ? node.range.end.line + 1 : undefined,
        depth,
      });
    }
    if (node.children) flattenDocumentSymbols(node.children, depth + 1, output);
  }
  return output;
}
