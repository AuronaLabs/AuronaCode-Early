export type PositionEncoding = "utf-8" | "utf-16";

export interface LspPosition {
  line: number;
  character: number;
}

export function normalizePositionEncoding(value: string | undefined): PositionEncoding {
  return value?.toLowerCase() === "utf-8" ? "utf-8" : "utf-16";
}

export function utf16ColumnToLsp(
  lineText: string,
  utf16Column: number,
  encoding: PositionEncoding,
): number {
  const safeColumn = Math.max(0, Math.min(utf16Column, lineText.length));
  if (encoding === "utf-16") return safeColumn;
  return new TextEncoder().encode(lineText.slice(0, safeColumn)).length;
}

export function lspColumnToUtf16(
  lineText: string,
  lspColumn: number,
  encoding: PositionEncoding,
): number {
  const safeColumn = Math.max(0, lspColumn);
  if (encoding === "utf-16") return Math.min(safeColumn, lineText.length);

  let utf8Length = 0;
  let utf16Column = 0;
  for (const character of lineText) {
    const characterBytes = new TextEncoder().encode(character).length;
    if (utf8Length + characterBytes > safeColumn) break;
    utf8Length += characterBytes;
    utf16Column += character.length;
  }
  return utf16Column;
}

export function positionForEncoding(
  text: string,
  position: LspPosition,
  encoding: PositionEncoding,
): LspPosition {
  const lineText = text.split(/\r?\n/)[position.line] ?? "";
  return {
    line: Math.max(0, position.line),
    character: utf16ColumnToLsp(lineText, position.character, encoding),
  };
}
