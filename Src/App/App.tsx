import { useEffect } from "react";
import { AppShell } from "../Layout/AppShell";
import { WorkspaceView } from "../Layout/Workspace";
import { WorkspaceProvider } from "../State/WorkspaceContext";
import { TerminalProvider } from "../State/TerminalContext";
import { EditorProvider } from "../State/EditorContext";

export default function App() {
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 禁用原生的 Ctrl+F
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
  }, []);

  return (
    <WorkspaceProvider>
      <TerminalProvider>
        <EditorProvider>
          <AppShell Children={<WorkspaceView />} />
        </EditorProvider>
      </TerminalProvider>
    </WorkspaceProvider>
  );
}
