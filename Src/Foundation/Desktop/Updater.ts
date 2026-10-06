import { invokeDesktop, listenDesktop } from "./Transport";

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

export const desktopUpdater = {
  check: (options?: { proxy?: string }): Promise<UpdateInfo | null> =>
    invokeDesktop("app_update_check", { proxy: options?.proxy }),
  clear(): void {
    void invokeDesktop("app_update_clear").catch(() => undefined);
  },
  async install(onProgress: (progress: UpdateProgress) => void): Promise<void> {
    const unlisten = await listenDesktop<UpdateProgress>("app-update-progress", onProgress);
    try {
      await invokeDesktop("app_update_install");
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      onProgress({ status: "error", progress: 0, error });
      throw cause;
    } finally {
      unlisten();
    }
  },
};
