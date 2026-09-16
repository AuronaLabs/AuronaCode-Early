import { relaunch } from "@tauri-apps/plugin-process";
import { type CheckOptions, check, type Update } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export type UpdateProgress =
  | { status: "started"; progress: number; total?: number }
  | { status: "progress"; progress: number; total?: number; current: number }
  | { status: "finished"; progress: 1 }
  | { status: "error"; progress: number; error: string };

let pendingUpdate: Update | null = null;

const toInfo = (update: Update): UpdateInfo => ({
  version: update.version,
  currentVersion: update.currentVersion,
  date: update.date,
  body: update.body,
});

export const desktopUpdater = {
  /** options.proxy 覆盖检查与后续下载的代理；不传则跟随系统默认 */
  async check(options?: CheckOptions): Promise<UpdateInfo | null> {
    pendingUpdate = await check(options);
    return pendingUpdate ? toInfo(pendingUpdate) : null;
  },

  clear(): void {
    pendingUpdate = null;
  },

  async install(onProgress: (progress: UpdateProgress) => void): Promise<void> {
    if (!pendingUpdate) return;
    let downloaded = 0;
    let contentLength = 0;
    try {
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            onProgress({ status: "started", progress: 0, total: contentLength || undefined });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            onProgress({
              status: "progress",
              progress: contentLength > 0 ? downloaded / contentLength : 0,
              total: contentLength || undefined,
              current: downloaded,
            });
            break;
          case "Finished":
            onProgress({ status: "finished", progress: 1 });
            break;
        }
      });
      await relaunch();
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      onProgress({ status: "error", progress: 0, error });
      throw cause;
    }
  },
};
