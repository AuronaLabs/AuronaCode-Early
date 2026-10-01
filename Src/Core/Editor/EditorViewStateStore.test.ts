import {
  loadEditorViewState,
  removeEditorViewState,
  saveEditorViewState,
} from "./EditorViewStateStore";

describe("EditorViewStateStore", () => {
  beforeEach(() => localStorage.clear());

  it("persists view state by file and removes stale entries", () => {
    const state = {
      path: "C:\\work\\README.md",
      line: 12,
      column: 4,
      scrollTop: 420,
      scrollLeft: 8,
      selectionStart: { line: 12, column: 1 },
      selectionEnd: { line: 12, column: 4 },
      foldedLines: [2, 8],
      mode: "preview" as const,
    };
    saveEditorViewState(state.path, state);
    expect(loadEditorViewState(state.path)).toEqual(state);
    removeEditorViewState(state.path);
    expect(loadEditorViewState(state.path)).toBeNull();
  });
});
