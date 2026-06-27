import { createContext, useContext, useEffect, useState, useMemo } from "react";
import { EditorAdapter } from "../Features/Editor/EditorAdapter";
import type { EditorStatus } from "../Foundation/Types/Editor";
import { EMPTY_EDITOR_STATUS } from "../Foundation/Types/Editor";
import type { ReactNode } from "react";

export interface EditorContextValue {
  editorStatus: EditorStatus;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [editorStatus, setEditorStatus] = useState<EditorStatus>(
    EditorAdapter.getStatus() ?? EMPTY_EDITOR_STATUS
  );

  useEffect(() => {
    return EditorAdapter.onStatusChange(setEditorStatus);
  }, []);

  const value = useMemo(() => ({ editorStatus }), [editorStatus]);

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside EditorProvider");
  return ctx;
}
