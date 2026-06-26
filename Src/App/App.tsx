import { AppShell } from "../Layout/AppShell";
import { WorkspaceView } from "../Layout/Workspace";
import { WorkspaceProvider } from "../State/WorkspaceContext";
import { TerminalProvider } from "../State/TerminalContext";
import { EditorProvider } from "../State/EditorContext";

export default function App() {
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
