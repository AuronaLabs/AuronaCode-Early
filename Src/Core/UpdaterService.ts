import { desktopUpdater, type UpdateInfo, type UpdateProgress } from "../Foundation/Desktop";
import { EventBus } from "../Foundation/EventBus";
import { Logger } from "../Foundation/Logger";
import { parseAuronaVersion } from "../Foundation/Release/ReleaseChannel";
import { useFeatureFlagStore } from "../State/useFeatureFlagStore";

export type UpdateCheckResult =
  | { status: "available"; update: UpdateInfo }
  | { status: "up-to-date" }
  | { status: "error"; error: string };

export const UpdaterService = {
  currentUpdate: null as UpdateInfo | null,

  async checkForUpdates(): Promise<UpdateCheckResult> {
    try {
      const channel = useFeatureFlagStore.getState().channel;
      const update = await desktopUpdater.check();

      if (update) {
        const parsed = parseAuronaVersion(update.version);

        // 如果用户处于 Stable 稳定生产渠道，但更新包属于 Pioneer 预发布测试版，则自动忽略
        if (channel === "stable" && parsed.isPreRelease) {
          Logger.info(
            `Ignoring pre-release update ${update.version} because client channel is stable`,
          );
          this.currentUpdate = null;
          desktopUpdater.clear();
          return { status: "up-to-date" };
        }

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
