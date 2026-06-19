import { AppShell } from "../Layout/AppShell";
import { WorkspaceView } from "../Layout/Workspace";

export default function App() {
  return <AppShell Children={<WorkspaceView />} />;
}
