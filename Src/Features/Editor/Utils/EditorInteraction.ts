import { sortSelection } from "./EditorMath";

export interface EditorPosition {
  line: number;
  char: number;
}

export interface EditorSelection {
  start: EditorPosition;
  end: EditorPosition;
}

function comparePosition(left: EditorPosition, right: EditorPosition): number {
  if (left.line !== right.line) return left.line - right.line;
  return left.char - right.char;
}

/** Editor selections are half-open: the character at `end` is not selected. */
export function selectionContainsPosition(
  selection: EditorSelection | null,
  position: EditorPosition,
): boolean {
  if (!selection) return false;
  const { start, end } = sortSelection(selection);
  if (comparePosition(start, end) === 0) return false;
  return comparePosition(start, position) <= 0 && comparePosition(position, end) < 0;
}

export type PointerSelectionDecision =
  | { kind: "preserve-selection" }
  | { kind: "place-caret"; position: EditorPosition; beginDrag: boolean };

export function pointerSelectionDecision(
  button: number,
  position: EditorPosition,
  selection: EditorSelection | null,
): PointerSelectionDecision {
  if (button === 2 && selectionContainsPosition(selection, position)) {
    return { kind: "preserve-selection" };
  }
  return { kind: "place-caret", position, beginDrag: button === 0 };
}
