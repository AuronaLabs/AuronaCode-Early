import { create } from "zustand";
import { EditorAdapter } from "../Features/Editor/EditorAdapter";
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

EditorAdapter.onStatusChange((status) => {
  useEditorStore.getState()._setEditorStatus(status);
});
