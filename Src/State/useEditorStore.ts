import { create } from "zustand";
import { EditorAdapter } from "../Features/Editor/EditorAdapter";
import { LspClient } from "../Features/Editor/LspClient";
import type { EditorStatus } from "../Foundation/Types/Editor";
import { EMPTY_EDITOR_STATUS } from "../Foundation/Types/Editor";

export interface EditorState {
  editorStatus: EditorStatus;
  _setEditorStatus: (status: EditorStatus) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  editorStatus: EditorAdapter.getStatus() ?? EMPTY_EDITOR_STATUS,
  _setEditorStatus: (status) => set({ editorStatus: status }),
}));

export function initializeEditorStore(): () => void {
  useEditorStore.getState()._setEditorStatus(EditorAdapter.getStatus() ?? EMPTY_EDITOR_STATUS);
  const unsubscribe = EditorAdapter.onStatusChange((status) => {
    useEditorStore.getState()._setEditorStatus(status);
  });
  return () => {
    unsubscribe();
    LspClient.disposeCurrent();
    useEditorStore.getState()._setEditorStatus(EMPTY_EDITOR_STATUS);
  };
}
