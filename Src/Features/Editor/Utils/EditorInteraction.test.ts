import { describe, expect, it } from "vitest";
import { pointerSelectionDecision, selectionContainsPosition } from "./EditorInteraction";

const selection = {
  start: { line: 1, char: 2 },
  end: { line: 2, char: 4 },
};

describe("EditorInteraction", () => {
  it("treats selections as half-open across lines", () => {
    expect(selectionContainsPosition(selection, { line: 1, char: 2 })).toBe(true);
    expect(selectionContainsPosition(selection, { line: 2, char: 3 })).toBe(true);
    expect(selectionContainsPosition(selection, { line: 2, char: 4 })).toBe(false);
  });

  it("preserves an existing selection when right-clicking inside it", () => {
    expect(pointerSelectionDecision(2, { line: 1, char: 6 }, selection)).toEqual({
      kind: "preserve-selection",
    });
  });

  it("moves the caret without starting a drag when right-clicking outside", () => {
    expect(pointerSelectionDecision(2, { line: 0, char: 1 }, selection)).toEqual({
      kind: "place-caret",
      position: { line: 0, char: 1 },
      beginDrag: false,
    });
  });
});
