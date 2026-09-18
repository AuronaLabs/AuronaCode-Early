import { desktopUpdater, type UpdateInfo, type UpdateProgress } from "../Foundation/Desktop";
import { EventBus } from "../Foundation/EventBus";
import { Logger } from "../Foundation/Logger";
import { parseAuronaVersion } from "../Foundation/Release/ReleaseChannel";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import { useFeatureFlagStore } from "../State/useFeatureFlagStore";

export type UpdateCheckResult =
  | { status: "available"; update: UpdateInfo }
  | { status: "up-to-date" }
  | { status: "error"; error: string };

/** 更新检查网络超时：超时后立即反馈错误，避免 UI 无限 loading */
const UPDATE_CHECK_TIMEOUT_MS = 15_000;

export interface UpdateNetworkPreferences {
  proxyMode?: string;
  proxyUrl?: string;
}

/**
 * 纯函数：更新检查/下载的代理偏好。
 * 仅自定义模式且填了代理地址时直传 check 选项；其余模式跟随系统默认。
 */
export function buildUpdateCheckOptions(
  network?: UpdateNetworkPreferences,
): { proxy: string } | undefined {
  return network?.proxyMode === "custom" && network.proxyUrl
    ? { proxy: network.proxyUrl }
    : undefined;
}

export const UpdaterService = {
  currentUpdate: null as UpdateInfo | null,

  async checkForUpdates(): Promise<UpdateCheckResult> {
    try {
      const channel = useFeatureFlagStore.getState().channel;
      // 代理偏好：自定义模式直传 check 选项（覆盖检查与下载）；其余模式跟随系统默认
      const network = (await UserConfigStore.get()).network;
      const checkOptions = buildUpdateCheckOptions(network);
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const update = await Promise.race([
        desktopUpdater.check(checkOptions),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error("update-check-timeout")),
            UPDATE_CHECK_TIMEOUT_MS,
          );
        }),
      ]).finally(() => {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      });

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
      if (cause instanceof Error && cause.message === "update-check-timeout") {
        Logger.error("Update check timed out");
        return { status: "error", error: "timeout" };
      }
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
