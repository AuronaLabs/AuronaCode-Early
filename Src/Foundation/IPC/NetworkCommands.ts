import { invokeDesktop } from "../Desktop";

export const NetworkIPC = {
  cachedCatalog: (source: string) =>
    invokeDesktop<unknown>("marketplace_cached_catalog", { source }),
  cancelTask: (taskId: string) => invokeDesktop<void>("task_cancel", { taskId }),
  marketplaceRequest: (request: {
    requestId: string;
    url: string;
    method: string;
    body: string | null;
    headers: Record<string, string>;
  }) =>
    invokeDesktop<{ status: number; body: string; catalog_verified: boolean }>(
      "marketplace_request",
      { request },
    ),
  cancelMarketplaceRequest: (requestId: string) =>
    invokeDesktop<void>("marketplace_cancel", { requestId }),
  marketplaceImage: (source: string) => invokeDesktop<string>("marketplace_image", { source }),
  downloadArtifact: (
    url: string,
    extensionId: string,
    version?: string,
    taskId = crypto.randomUUID(),
  ) =>
    invokeDesktop<{ artifactId: string; sha256: string; sizeBytes: number; verified: boolean }>(
      "artifact_download",
      { url, extensionId, version, taskId },
    ),
  pickArtifact: (kind: "extension" | "toolchain" | "vscode" = "extension") =>
    invokeDesktop<{
      artifactId: string;
      sha256: string;
      sizeBytes: number;
      verified: boolean;
    } | null>("artifact_pick", { kind }),
  /** 同步代理偏好到 Rust 全局状态（工具链下载使用） */
  setNetworkProxy: (mode: "system" | "custom" | "none", url?: string) =>
    invokeDesktop<void>("set_network_proxy", { mode, url }),
};
