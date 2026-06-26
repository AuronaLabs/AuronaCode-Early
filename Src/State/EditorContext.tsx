import { createContext, useContext, useEffect, useState } from "react";
import { EditorAdapter } from "../Features/Editor/EditorAdapter";
import type { EditorStatus } from "../Foundation/Types/Editor";
import { EMPTY_EDITOR_STATUS } from "../Foundation/Types/Editor";
import type { ReactNode } from "react";

export interface EditorContextValue {
  editorStatus: EditorStatus;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [editorStatus, setEditorStatus] = useState<EditorStatus>(EditorAdapter.getStatus());

  useEffect(() => {
    return EditorAdapter.onStatusChange(setEditorStatus);
  }, []);

  void EMPTY_EDITOR_STATUS; // 确保 import 不被 tree-shake

  return (
    <EditorContext.Provider value={{ editorStatus }}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside EditorProvider");
  return ctx;
}
