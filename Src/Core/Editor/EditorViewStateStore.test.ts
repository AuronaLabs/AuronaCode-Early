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

  it("evicts the least recently used tab state", () => {
    const view = (path: string) => ({
      path,
      line: 1,
      column: 1,
      scrollTop: 0,
      scrollLeft: 0,
    });
    for (let index = 0; index < 100; index++) {
      saveEditorViewState(`C:\\work\\file-${index}.ts`, view(`C:\\work\\file-${index}.ts`));
    }

    expect(loadEditorViewState("C:\\work\\file-0.ts")).not.toBeNull();
    saveEditorViewState("C:\\work\\file-100.ts", view("C:\\work\\file-100.ts"));

    expect(loadEditorViewState("C:\\work\\file-0.ts")).not.toBeNull();
    expect(loadEditorViewState("C:\\work\\file-1.ts")).toBeNull();
  });
});
