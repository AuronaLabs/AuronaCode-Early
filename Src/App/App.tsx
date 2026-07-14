import { useEffect, useRef } from "react";
import { AppShell } from "../Layout/AppShell";
import { WorkspaceView } from "../Layout/Workspace";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { EventBus } from "../Foundation/EventBus";
import { invoke } from "@tauri-apps/api/core";
import { handleSmartRun } from "../Shared/Constants/RunConfig";
import { UpdaterService } from "../Core/UpdaterService";
import { useGlassStore } from "../UI/Core/GlassManager";

export default function App() {
  const activeFileRef = useRef<string | null>(null);

  useEffect(() => {
    // Initialize GlassManager
    useGlassStore.getState().applyToDOM();

    // Check for updates silently after 3 seconds
    setTimeout(() => {
      UpdaterService.checkForUpdates();
    }, 3000);

    const unsubFile = EventBus.on("app:active-file-changed", (path: string | null) => {
      activeFileRef.current = path;
    });

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });

    if (navigator.userAgent.includes("Mac")) {
      const setupMacMenu = async () => {
        try {
          const appMenu = await Submenu.new({
            text: "Aurona Code",
            items: [
              await PredefinedMenuItem.new({ item: { About: null } }),
              await PredefinedMenuItem.new({ item: "Separator" }),
              await PredefinedMenuItem.new({ item: "Services" }),
              await PredefinedMenuItem.new({ item: "Separator" }),
              await PredefinedMenuItem.new({ item: "Hide" }),
              await PredefinedMenuItem.new({ item: "HideOthers" }),
              await PredefinedMenuItem.new({ item: "ShowAll" }),
              await PredefinedMenuItem.new({ item: "Separator" }),
              await PredefinedMenuItem.new({ item: "Quit" }),
            ],
          });

          const fileMenu = await Submenu.new({
            text: "文件",
            items: [
              await MenuItem.new({
                text: "新建文件",
                accelerator: "CmdOrControl+N",
                action: () => EventBus.emit("app:create-file-prompt"),
              }),
              await MenuItem.new({
                text: "新建文件夹",
                action: () => EventBus.emit("app:create-folder-prompt"),
              }),
              await PredefinedMenuItem.new({ item: "Separator" }),
              await MenuItem.new({
                text: "打开文件...",
                action: () => EventBus.emit("app:open-file"),
              }),
              await MenuItem.new({
                text: "打开文件夹...",
                action: () => EventBus.emit("app:open-folder"),
              }),
              await MenuItem.new({
                text: "保存",
                accelerator: "CmdOrControl+S",
                action: () => EventBus.emit("app:save-file"),
              }),
            ],
          });

          const editMenu = await Submenu.new({
            text: "编辑",
            items: [
              await PredefinedMenuItem.new({ item: "Undo" }),
              await PredefinedMenuItem.new({ item: "Redo" }),
              await PredefinedMenuItem.new({ item: "Separator" }),
              await PredefinedMenuItem.new({ item: "Cut" }),
              await PredefinedMenuItem.new({ item: "Copy" }),
              await PredefinedMenuItem.new({ item: "Paste" }),
              await PredefinedMenuItem.new({ item: "Separator" }),
              await PredefinedMenuItem.new({ item: "SelectAll" }),
            ],
          });

          const runMenu = await Submenu.new({
            text: "运行",
            items: [
              await MenuItem.new({
                text: "运行当前文件",
                action: () => {
                  if (activeFileRef.current) {
                    handleSmartRun(activeFileRef.current);
                  } else {
                    EventBus.emit("app:toast", {
                      type: "warning",
                      message: "没有可运行的活动文件",
                    });
                  }
                },
              }),
            ],
          });

          const helpMenu = await Submenu.new({
            text: "帮助",
            items: [
              await MenuItem.new({
                text: "版本更新记录",
                action: () =>
                  EventBus.emit("app:open-tab", {
                    id: "changelog",
                    type: "changelog",
                    title: "更新记录",
                  }),
              }),
              await PredefinedMenuItem.new({ item: "Separator" }),
              await MenuItem.new({
                text: "开发者工具",
                action: () => {
                  invoke("open_devtools").catch((err) => {
                    EventBus.emit("app:toast", { type: "warning", message: err });
                  });
                },
              }),
            ],
          });

          const menu = await Menu.new({
            items: [appMenu, fileMenu, editMenu, runMenu, helpMenu],
          });

          await menu.setAsAppMenu();
        } catch (e) {
          console.error("Failed to setup macOS native menu", e);
        }
      };

      setupMacMenu();
    }

    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
      unsubFile();
    };
  }, []);

  return <AppShell Children={<WorkspaceView />} />;
}
