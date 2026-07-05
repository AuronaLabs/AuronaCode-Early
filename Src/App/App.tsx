import { useEffect } from "react";
import { AppShell } from "../Layout/AppShell";
import { WorkspaceView } from "../Layout/Workspace";

export default function App() {
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
  }, []);

  return <AppShell Children={<WorkspaceView />} />;
}
