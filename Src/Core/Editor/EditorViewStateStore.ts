import type { EditorViewState } from "../../Foundation/Types/Editor";

const STORAGE_KEY = "aurona.editor.view-state.v1";
const MAX_ENTRIES = 100;

type StoredState = Record<string, EditorViewState>;

function read(): StoredState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return value && typeof value === "object" ? (value as StoredState) : {};
  } catch {
    return {};
  }
}

function write(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // View state is a convenience; the editor remains usable when storage is full.
  }
}

export function loadEditorViewState(path: string): EditorViewState | null {
  const state = read()[path];
  if (!state || typeof state !== "object") return null;
  return state;
}

export function saveEditorViewState(path: string, view: EditorViewState): void {
  const state = read();
  const next: StoredState = { ...state, [path]: view };
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete next[key];
  }
  write(next);
}

export function removeEditorViewState(path: string): void {
  const state = read();
  if (!(path in state)) return;
  delete state[path];
  write(state);
}
