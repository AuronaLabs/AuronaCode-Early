import type { TextEdit } from "../../Foundation/IPC/EditorCommands";

export interface DocumentRangeEdit {
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  newText: string;
}

/** Convert one-based line/UTF-16 positions against one snapshot, then apply from the end. */
export function prepareDocumentEdits(
  content: string,
  changes: readonly DocumentRangeEdit[],
): { content: string; edits: TextEdit[] } {
  const lines = content.split("\n");
  const starts: number[] = [];
  let start = 0;
  for (const line of lines) {
    starts.push(start);
    start += line.length + 1;
  }
  const offset = (line: number, column: number): number => {
    if (
      !Number.isSafeInteger(line) ||
      !Number.isSafeInteger(column) ||
      line < 1 ||
      line > lines.length ||
      column < 1
    )
      throw new Error("[editor.range] Invalid edit position");
    const text = lines[line - 1];
    const length = text.endsWith("\r") ? text.length - 1 : text.length;
    if (column > length + 1) throw new Error("[editor.range] Edit column exceeds line length");
    return starts[line - 1] + column - 1;
  };
  const edits = changes
    .map((change) => ({
      startUtf16: offset(change.range.startLine, change.range.startColumn),
      endUtf16: offset(change.range.endLine, change.range.endColumn),
      text: change.newText,
    }))
    .sort((a, b) => b.startUtf16 - a.startUtf16 || b.endUtf16 - a.endUtf16);
  let previous = content.length;
  for (const edit of edits) {
    if (edit.endUtf16 < edit.startUtf16 || edit.endUtf16 > previous)
      throw new Error("[editor.range] Edit ranges overlap or are reversed");
    previous = edit.startUtf16;
    content = content.slice(0, edit.startUtf16) + edit.text + content.slice(edit.endUtf16);
  }
  return { content, edits };
}
