import { useEffect } from "react";
import { UpdaterService } from "../Core/UpdaterService";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { setupMacApplicationMenu } from "../Foundation/Desktop";
import { AppShell } from "../Layout/AppShell";
import { WorkspaceView } from "../Layout/Workspace";
import { useGlassStore } from "../UI/Core/GlassManager";

export default function App() {
  useEffect(() => {
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

    if (navigator.userAgent.includes("Mac")) {
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
      }).catch((error) => console.error("Failed to setup macOS native menu", error));
    }

    return () => {
      themeObserver.disconnect();
      window.clearTimeout(updateTimer);
      window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
    };
  }, []);

  return <AppShell Children={<WorkspaceView />} />;
}
