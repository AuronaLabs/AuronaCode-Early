import { invokeDesktop } from "../Desktop";

export const NetworkIPC = {
  cancelTask: (taskId: string) => invokeDesktop<void>("task_cancel", { taskId }),
  pickArtifact: (kind: "extension" | "toolchain" | "vscode" = "extension") =>
    invokeDesktop<{
      artifactId: string;
      sha256: string;
      sizeBytes: number;
      verified: boolean;
    } | null>("artifact_pick", { kind }),
  /** 同步代理偏好到 Rust 全局状态（应用更新检查使用） */
  setNetworkProxy: (mode: "system" | "custom" | "none", url?: string) =>
    invokeDesktop<void>("set_network_proxy", { mode, url }),
};
