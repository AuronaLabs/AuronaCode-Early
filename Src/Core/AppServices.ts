import { RecoveryCoordinator } from "../Features/Editor/Model/RecoveryCoordinator";
import { desktopWindow } from "../Foundation/Desktop";
import { WorkspaceStore } from "../Foundation/Storage/WorkspaceStore";
import { initializeEditorStore } from "../State/useEditorStore";
import { initializeTerminalStore } from "../State/useTerminalStore";
import { initializeWorkbenchStore } from "../State/useWorkspaceStore";
import { registerWorkbenchCommands } from "./Commands";

let startPromise: Promise<void> | null = null;
let disposers: (() => void)[] = [];
let shouldBeStarted = false;

async function initializeCloseProtection(): Promise<() => void> {
  let destroying = false;
  const unlisten = await desktopWindow.onCloseRequested(async (event) => {
    if (destroying) return;
    event.preventDefault();
    await RecoveryCoordinator.flushAll();
    destroying = true;
    await desktopWindow.destroy();
  });
  return unlisten;
}

export const AppServices = {
  async start(): Promise<void> {
    shouldBeStarted = true;
    if (disposers.length > 0) return;
    if (startPromise) return startPromise;
    startPromise = (async () => {
      const disposeWorkbench = await initializeWorkbenchStore();
      if (!shouldBeStarted || disposers.length > 0) {
        disposeWorkbench();
        return;
      }
      const disposeCloseProtection = await initializeCloseProtection();
      if (!shouldBeStarted || disposers.length > 0) {
        disposeCloseProtection();
        disposeWorkbench();
        return;
      }
      disposers = [
        disposeWorkbench,
        disposeCloseProtection,
        initializeTerminalStore(),
        initializeEditorStore(),
        registerWorkbenchCommands(),
      ];
    })();
    try {
      await startPromise;
    } finally {
      startPromise = null;
    }
  },

  dispose(): void {
    shouldBeStarted = false;
    const current = disposers;
    disposers = [];
    for (const dispose of current.reverse()) dispose();
    void WorkspaceStore.flush();
  },
};
