import { useEffect } from "react";
import { UpdaterService } from "../Core/UpdaterService";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { setupMacApplicationMenu } from "../Foundation/Desktop";
import { Logger } from "../Foundation/Logger";
import { PlatformService } from "../Foundation/Platform";
import { AppShell } from "../Layout/AppShell";
import { WorkspaceView } from "../Layout/Workspace";
import { isRunnable } from "../Shared/Constants/RunConfig";
import { useWorkbenchStore } from "../State/useWorkspaceStore";
import { useGlassStore } from "../UI/Core/GlassManager";

export default function App() {
  useEffect(() => {
    let disposed = false;
    let disposeMacMenu: (() => void) | undefined;
    let unsubscribeWorkbench: (() => void) | undefined;
    useGlassStore.getState().applyToDOM();
    const themeObserver = new MutationObserver(() => {
      useGlassStore.getState().applyToDOM();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const updateTimer = window.setTimeout(() => {
      void UpdaterService.checkForUpdates();
    }, 3_000);

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      Logger.error("Unhandled Promise Rejection", reason);
    };
    const handleUnhandledError = (event: ErrorEvent) => {
      Logger.error("Unhandled window error", event.error ?? event.message);
    };
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleUnhandledError);

    if (PlatformService.isMacOS()) {
      void setupMacApplicationMenu({
        createFile: () => void CommandRegistry.execute("workbench.action.files.newFile"),
        createFolder: () => void CommandRegistry.execute("workbench.action.files.newFolder"),
        openFile: () => void CommandRegistry.execute("workbench.action.files.openFile"),
        openFolder: () => void CommandRegistry.execute("workbench.action.files.openFolder"),
        saveFile: () => void CommandRegistry.execute("workbench.action.files.save"),
        runActiveFile: () => void CommandRegistry.execute("workbench.action.runActiveFile"),
        openChangelog: () => void CommandRegistry.execute("workbench.action.openChangelog"),
        openPerformance: () => void CommandRegistry.execute("workbench.action.openPerformance"),
        openDevtools: () => void CommandRegistry.execute("workbench.action.openDevtools"),
      })
        .then((controller) => {
          if (disposed) {
            controller.dispose();
            return;
          }
          const synchronize = () => {
            const state = useWorkbenchStore.getState();
            const active = state.tabs.find((tab) => tab.id === state.activeTabId);
            const path = active?.type === "file" ? (active.path ?? null) : null;
            void controller
              .update({
                canSave: path !== null && Boolean(active?.isDirty),
                canRun: path !== null && isRunnable(path),
              })
              .catch((error) => console.error("Failed to update macOS native menu", error));
          };
          synchronize();
          unsubscribeWorkbench = useWorkbenchStore.subscribe(synchronize);
          disposeMacMenu = () => controller.dispose();
        })
        .catch((error) => console.error("Failed to setup macOS native menu", error));
    }

    return () => {
      disposed = true;
      unsubscribeWorkbench?.();
      disposeMacMenu?.();
      themeObserver.disconnect();
      window.clearTimeout(updateTimer);
      window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleUnhandledError);
    };
  }, []);

  return <AppShell Children={<WorkspaceView />} />;
}
