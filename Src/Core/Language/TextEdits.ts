import type { TextEdit as DocumentTextEdit } from "../../Foundation/IPC/EditorCommands";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspTextEdit {
  range: { start: LspPosition; end: LspPosition };
  newText: string;
}

export interface AppliedTextEdits {
  content: string;
  documentEdits: DocumentTextEdit[];
}

export function positionToUtf16Offset(content: string, position: LspPosition): number {
  if (position.line < 0 || position.character < 0) {
    throw new Error("Text edit position must not be negative");
  }
  let offset = 0;
  let line = 0;
  while (line < position.line) {
    const newline = content.indexOf("\n", offset);
    if (newline < 0) throw new Error(`Text edit line ${position.line + 1} is out of bounds`);
    offset = newline + 1;
    line++;
  }
  const lineEnd = content.indexOf("\n", offset);
  const end = lineEnd < 0 ? content.length : lineEnd;
  const target = offset + position.character;
  if (target > end) throw new Error("Text edit character is out of bounds");
  return target;
}

export function applyLspTextEdits(
  content: string,
  edits: readonly LspTextEdit[],
): AppliedTextEdits {
  const normalized = edits
    .map((edit) => ({
      startUtf16: positionToUtf16Offset(content, edit.range.start),
      endUtf16: positionToUtf16Offset(content, edit.range.end),
      text: edit.newText,
    }))
    .sort((left, right) => right.startUtf16 - left.startUtf16 || right.endUtf16 - left.endUtf16);

  for (let index = 0; index < normalized.length; index++) {
    const edit = normalized[index];
    if (edit.startUtf16 > edit.endUtf16) throw new Error("Text edit range is reversed");
    const previous = normalized[index - 1];
    if (previous && edit.endUtf16 > previous.startUtf16) {
      throw new Error("Language server returned overlapping text edits");
    }
  }

  let nextContent = content;
  for (const edit of normalized) {
    nextContent =
      nextContent.slice(0, edit.startUtf16) + edit.text + nextContent.slice(edit.endUtf16);
  }
  return { content: nextContent, documentEdits: normalized };
}
