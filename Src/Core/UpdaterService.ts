import { check, type Update } from "@tauri-apps/plugin-updater";
import { EventBus } from "../Foundation/EventBus";
import { relaunch } from "@tauri-apps/plugin-process";

export const UpdaterService = {
  currentUpdate: null as Update | null,

  async checkForUpdates() {
    try {
      const update = await check();
      if (update) {
        console.log(`Update available: ${update.version} from ${update.date}`);
        this.currentUpdate = update;
        EventBus.emit("app:update-available", update);
      } else {
        console.log("No updates available");
        this.currentUpdate = null;
      }
    } catch (e) {
      console.error("Failed to check for updates:", e);
    }
  },

  async installUpdate() {
    if (this.currentUpdate) {
      let downloaded = 0;
      let contentLength = 0;

      try {
        await this.currentUpdate.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              contentLength = event.data.contentLength || 0;
              EventBus.emit("app:update-progress", { status: "started", progress: 0 });
              break;
            case "Progress":
              downloaded += event.data.chunkLength;
              if (contentLength > 0) {
                EventBus.emit("app:update-progress", {
                  status: "progress",
                  progress: downloaded / contentLength,
                });
              }
              break;
            case "Finished":
              EventBus.emit("app:update-progress", { status: "finished", progress: 1 });
              break;
          }
        });

        await relaunch();
      } catch (e) {
        console.error("Failed to install update:", e);
        EventBus.emit("app:update-progress", { status: "error", error: String(e) });
      }
    }
  },
};
