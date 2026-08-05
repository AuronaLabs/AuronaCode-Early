export interface TextInsertCursor {
  line: number;
  char: number;
}

/** Inserts `text` at `cursor` and returns the resulting lines and caret. */
export function insertTextIntoLines(
  lines: readonly string[],
  cursor: TextInsertCursor,
  text: string,
): { lines: string[]; cursor: TextInsertCursor } {
  const nextLines = [...lines];
  const lineText = nextLines[cursor.line] || "";
  const newLines = text.split("\n");
  let targetCursor: TextInsertCursor = { ...cursor };

  if (newLines.length === 1) {
    nextLines[cursor.line] =
      lineText.substring(0, cursor.char) + text + lineText.substring(cursor.char);
    targetCursor = { line: cursor.line, char: cursor.char + text.length };
  } else {
    const rest = lineText.substring(cursor.char);
    nextLines[cursor.line] = lineText.substring(0, cursor.char) + newLines[0];
    for (let i = 1; i < newLines.length - 1; i += 1) {
      nextLines.splice(cursor.line + i, 0, newLines[i]);
    }
    nextLines.splice(cursor.line + newLines.length - 1, 0, newLines[newLines.length - 1] + rest);
    targetCursor = {
      line: cursor.line + newLines.length - 1,
      char: newLines[newLines.length - 1].length,
    };
  }
  return { lines: nextLines, cursor: targetCursor };
}
