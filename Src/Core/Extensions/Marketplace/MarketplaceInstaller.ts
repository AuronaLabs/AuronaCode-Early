import { type ExtensionDescriptor, ExtensionIPC } from "../../../Foundation/IPC/ExtensionCommands";
import {
  type InstalledToolchainSummary,
  LanguageServerIPC,
  type ToolchainsOverview,
} from "../../../Foundation/IPC/LanguageServerCommands";
import { NetworkIPC } from "../../../Foundation/IPC/NetworkCommands";
import { canonicalExtensionId } from "../../../Foundation/Types/ExtensionId";
import type { MarketplaceExtensionItem } from "./MarketplaceContracts";
import { absoluteMarketplaceUrl } from "./MarketplaceModel";

interface CatalogAccess {
  getServerUrl(): Promise<string>;
  getDownloadUrl(id: string, version?: string): Promise<string>;
  fetchExtensionDetail(id: string): Promise<MarketplaceExtensionItem | null>;
}
/** Installation is independent from catalog refresh and extension activation. */
export function createMarketplaceInstaller(catalog: CatalogAccess) {
  const sharedRuntimeInstalls = new Map<string, Promise<void>>();
  return {
    async installExtension(
      id: string,
      version?: string,
      signal?: AbortSignal,
      onProgress?: (
        progress: number,
        stage: "downloading" | "completed" | "failed",
        message?: string,
      ) => void,
    ): Promise<ExtensionDescriptor> {
      id = canonicalExtensionId(id);
      const url = await catalog.getDownloadUrl(id, version);
      signal?.throwIfAborted();
      const taskId = crypto.randomUUID();
      const cancel = () => {
        void NetworkIPC.cancelTask(taskId).catch(() => undefined);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      let unsubscribe: (() => void) | undefined;
      try {
        if (onProgress) {
          unsubscribe = await NetworkIPC.onArtifactDownloadProgress((progress) => {
            if (progress.downloadId === taskId) {
              onProgress(progress.percentage, progress.stage, progress.message ?? undefined);
            }
          });
        }
        signal?.throwIfAborted();
        const artifact = await NetworkIPC.downloadArtifact(url, id, version, taskId);
        signal?.throwIfAborted();
        return await ExtensionIPC.install(artifact.artifactId);
      } finally {
        unsubscribe?.();
        signal?.removeEventListener("abort", cancel);
      }
    },

    async uninstallExtension(id: string): Promise<void> {
      await ExtensionIPC.uninstall(canonicalExtensionId(id));
    },

    async getRuntimeDownloadUrl(runtimeType = "node"): Promise<string> {
      const serverUrl = await catalog.getServerUrl();
      const cleanBase = serverUrl.trim().replace(/\/+$/, "");
      const base =
        cleanBase.endsWith("/api") || cleanBase.includes("/api/") ? cleanBase : `${cleanBase}/api`;
      return `${base}/runtimes/${encodeURIComponent(runtimeType)}/download`;
    },

    async installRuntime(
      id: string,
      version?: string,
      onProgress?: (progress: number, stage: string) => void,
      signal?: AbortSignal,
    ): Promise<InstalledToolchainSummary> {
      id = canonicalExtensionId(id);
      const detail = await catalog.fetchExtensionDetail(id);
      const metadata = detail?.runtimeMetadata;
      const runtimeType = metadata?.runtimeType ?? id;
      const serverUrl = await catalog.getServerUrl();
      const metadataDownloadUrl = metadata?.downloadUrl ?? detail?.downloadUrl;
      const downloadUrl = metadataDownloadUrl
        ? absoluteMarketplaceUrl(serverUrl, metadataDownloadUrl)
        : await catalog.getDownloadUrl(id, version);
      const downloadId = `runtime_${runtimeType}_${crypto.randomUUID()}`;
      signal?.throwIfAborted();
      const cancel = () => {
        void NetworkIPC.cancelTask(downloadId).catch(() => undefined);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      let unsub: (() => void) | undefined;
      try {
        if (onProgress) {
          unsub = await LanguageServerIPC.onDownloadProgress((progress) => {
            if (progress.downloadId === downloadId) onProgress(progress.percentage, progress.stage);
          });
        }
        signal?.throwIfAborted();
        return await LanguageServerIPC.installToolchainFromUrl(
          downloadId,
          downloadUrl,
          id,
          version ?? detail?.version,
          metadata?.sha256,
        );
      } finally {
        unsub?.();
        signal?.removeEventListener("abort", cancel);
      }
    },

    async ensureSharedRuntime(
      runtimeType = "node",
      onProgress?: (progress: number, stage: string) => void,
    ): Promise<void> {
      const pending = sharedRuntimeInstalls.get(runtimeType);
      if (pending) return pending;
      const install = this.installSharedRuntime(runtimeType, onProgress);
      sharedRuntimeInstalls.set(runtimeType, install);
      try {
        await install;
      } finally {
        sharedRuntimeInstalls.delete(runtimeType);
      }
    },

    async installSharedRuntime(
      runtimeType = "node",
      onProgress?: (progress: number, stage: string) => void,
    ): Promise<void> {
      if (runtimeType !== "node") return;
      try {
        const overview = await LanguageServerIPC.listToolchains();
        const hasNode = overview.runtimes.some((r) => r.runtimeType === "node");
        if (hasNode) return;
      } catch {
        // 忽略
      }

      const downloadId = `runtime_${runtimeType}_${Date.now()}`;
      const runtimeUrl = await this.getRuntimeDownloadUrl(runtimeType);

      let unsub: (() => void) | undefined;
      if (onProgress) {
        unsub = await LanguageServerIPC.onDownloadProgress((p) => {
          if (p.downloadId === downloadId) {
            onProgress(p.percentage, p.stage);
          }
        });
      }

      try {
        await LanguageServerIPC.installToolchainFromUrl(
          downloadId,
          runtimeUrl,
          "auronalabs.runtime-node",
        );
      } finally {
        if (unsub) unsub();
      }
    },

    async installLspServer(
      id: string,
      version?: string,
      onProgress?: (progress: number, stage: string) => void,
      signal?: AbortSignal,
    ): Promise<InstalledToolchainSummary> {
      id = canonicalExtensionId(id);
      signal?.throwIfAborted();
      // 1. 获取该 LSP 详情与依赖的运行时
      const detail = await catalog.fetchExtensionDetail(id);
      const reqRuntime = detail?.lspMetadata?.runtimeType || "node";

      // 2. 如果需要共享 Node 运行时，先确保本地 APPDATA 已就绪
      if (reqRuntime === "node") {
        await this.ensureSharedRuntime("node", onProgress);
      }

      // 3. 下载并安装 LSP 语言服务归档包
      const downloadId = `lsp_${id}_${crypto.randomUUID()}`;
      const downloadUrl = await catalog.getDownloadUrl(id, version);
      signal?.throwIfAborted();
      const cancel = () => {
        void NetworkIPC.cancelTask(downloadId).catch(() => undefined);
      };
      signal?.addEventListener("abort", cancel, { once: true });

      let unsub: (() => void) | undefined;
      try {
        if (onProgress) {
          unsub = await LanguageServerIPC.onDownloadProgress((p) => {
            if (p.downloadId === downloadId) onProgress(p.percentage, p.stage);
          });
        }
        signal?.throwIfAborted();
        const result = await LanguageServerIPC.installToolchainFromUrl(
          downloadId,
          downloadUrl,
          id,
          version ?? detail?.version,
        );
        return result;
      } finally {
        if (unsub) unsub();
        signal?.removeEventListener("abort", cancel);
      }
    },

    async uninstallLspServer(id: string): Promise<void> {
      await LanguageServerIPC.uninstallToolchain(canonicalExtensionId(id));
    },

    async listInstalledToolchains(): Promise<ToolchainsOverview> {
      return LanguageServerIPC.listToolchains();
    },

    async uninstallSharedRuntime(runtimeType: string): Promise<void> {
      await LanguageServerIPC.uninstallToolchainRuntime(runtimeType);
    },
  };
}
