import { desktopUpdater, type UpdateInfo, type UpdateProgress } from "../Foundation/Desktop";
import { EventBus } from "../Foundation/EventBus";
import { Logger } from "../Foundation/Logger";

export type UpdateCheckResult =
  | { status: "available"; update: UpdateInfo }
  | { status: "up-to-date" }
  | { status: "error"; error: string };

export const UpdaterService = {
  currentUpdate: null as UpdateInfo | null,

  async checkForUpdates(): Promise<UpdateCheckResult> {
    try {
      const update = await desktopUpdater.check();
      if (update) {
        this.currentUpdate = update;
        EventBus.emit("app:update-available", update);
        return { status: "available", update };
      }
      this.currentUpdate = null;
      desktopUpdater.clear();
      return { status: "up-to-date" };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      Logger.error("Update check failed", cause);
      return { status: "error", error };
    }
  },

  async installUpdate(): Promise<void> {
    if (!this.currentUpdate) return;
    try {
      await desktopUpdater.install((progress: UpdateProgress) => {
        EventBus.emit("app:update-progress", progress);
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      Logger.error("Update installation failed", cause);
      EventBus.emit("app:update-progress", { status: "error", progress: 0, error });
    }
  },
};
