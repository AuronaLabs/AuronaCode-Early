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

/**
 * 绝对 UTF-16 偏移 → {line, character(行内 UTF-16 列)}，兼容 \n 与 \r\n 行尾。
 * 偏移越界时钳制到文本长度；落点在 \r\n 的 \r 与 \n 之间时归入下一行行首。
 */
export function utf16OffsetToPosition(text: string, offset: number): LspPosition {
  const safe = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  let index = 0;
  while (index < safe) {
    const newlineIndex = text.indexOf("\n", index);
    if (newlineIndex === -1 || newlineIndex >= safe) break;
    line += 1;
    index = newlineIndex + 1;
    lineStart = index;
  }
  return { line, character: safe - lineStart };
}
