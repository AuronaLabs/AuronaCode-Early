import { check, type Update } from "@tauri-apps/plugin-updater";
import { EventBus } from "../Foundation/EventBus";
import { Logger } from "../Foundation/Logger";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateCheckResult =
  | { status: "available"; update: Update }
  | { status: "up-to-date" }
  | { status: "error"; error: string };

export const UpdaterService = {
  currentUpdate: null as Update | null,

  async checkForUpdates(): Promise<UpdateCheckResult> {
    try {
      const update = await check();
      if (update) {
        this.currentUpdate = update;
        EventBus.emit("app:update-available", update);
        return { status: "available", update };
      } else {
        this.currentUpdate = null;
        return { status: "up-to-date" };
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      Logger.error("Update check failed", cause);
      return { status: "error", error };
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
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        Logger.error("Update installation failed", cause);
        EventBus.emit("app:update-progress", { status: "error", error });
      }
    }
  },
};
