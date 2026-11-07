import { desktopAvailable } from "../../../Foundation/Desktop";
import type { I18nKey } from "../../../Foundation/I18n";
import {
  type ExtensionDescriptor,
  parseExtensionError,
} from "../../../Foundation/IPC/ExtensionCommands";
import { NetworkIPC } from "../../../Foundation/IPC/NetworkCommands";
import { UserConfigStore } from "../../../Foundation/Storage/UserConfigStore";
import { canonicalExtensionId } from "../../../Foundation/Types/ExtensionId";
import {
  fetchWithTimeout,
  marketplaceAuthHeaders,
  requestCandidateUrls,
} from "./MarketplaceClient";
import type {
  MarketplaceExtensionItem,
  MarketplaceFetchResult,
  MarketplaceRankingResult,
  MarketplaceRequestInput,
  MarketplaceSourceStatus,
  ReviewItem,
  ReviewsResponse,
  RuntimeMetadataItem,
} from "./MarketplaceContracts";
import { createMarketplaceInstaller } from "./MarketplaceInstaller";
import {
  absoluteMarketplaceUrl,
  compareVersions,
  extractMarketplaceItems,
  inputSignal,
  isRecord,
  normalizeExtension,
  readCachedCatalog,
  writeCachedCatalog,
} from "./MarketplaceModel";
import { boundedCatalog } from "./MarketplaceSchema";

export type * from "./MarketplaceContracts";
export {
  descriptorToMarketplaceItem,
  isAbortError,
  isOfficialMarketplaceHost,
} from "./MarketplaceModel";

export const DEFAULT_MARKETPLACE_URL = "https://marketplace.aurona.cc/api";
export const LOCAL_DEV_MARKETPLACE_URL = "http://127.0.0.1:5219/api";

export function formatMarketplaceInstallError(error: unknown, t: (key: I18nKey) => string): string {
  const parsed = parseExtensionError(error);
  if (
    parsed.code?.startsWith("signature.") ||
    parsed.code === "catalog.required" ||
    parsed.code === "catalog.expired" ||
    parsed.code === "artifact.source"
  ) {
    return `${t("extensions.signatureInstallUnavailable")}${parsed.detail ? ` (${parsed.detail})` : ""}`;
  }
  return parsed.detail || t("extensions.installFailed");
}

const MarketplaceCatalog = {
  async getServerUrl(): Promise<string> {
    const config = await UserConfigStore.get();
    const configured = config.marketplaceServerUrl?.trim();
    if (
      configured &&
      /^(https?:\/\/)?(?:127\.0\.0\.1|localhost):5218\/?$/.test(configured.replace(/\/api\/?$/, ""))
    ) {
      await UserConfigStore.set({ marketplaceServerUrl: LOCAL_DEV_MARKETPLACE_URL });
      return LOCAL_DEV_MARKETPLACE_URL;
    }
    return configured || DEFAULT_MARKETPLACE_URL;
  },

  async setServerUrl(url: string): Promise<void> {
    await UserConfigStore.set({ marketplaceServerUrl: url.trim() });
  },

  async fetchMarketplace(
    query?: string,
    category?: string,
    installedDescriptors: ExtensionDescriptor[] = [],
    options: MarketplaceRequestInput = {},
  ): Promise<MarketplaceFetchResult> {
    const signal = inputSignal(options);
    const page = "page" in options ? (options.page ?? 1) : 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || (query?.length ?? 0) > 512)
      throw new Error("[marketplace.pagination] Invalid page or search budget");
    if (signal?.aborted) throw new DOMException("The request was aborted", "AbortError");
    const serverUrl = await this.getServerUrl();
    let items: MarketplaceExtensionItem[] = [];
    let source: MarketplaceSourceStatus = "offline";
    let offlineReason: MarketplaceFetchResult["offlineReason"] = "server-unreachable";

    const cleanBase = serverUrl.trim().replace(/\/+$/, "");
    const candidateUrls: string[] = [];

    if (cleanBase.endsWith("/api") || cleanBase.includes("/api/")) {
      candidateUrls.push(`${cleanBase}/extensions`);
      candidateUrls.push(`${cleanBase.replace(/\/api\/?$/, "")}/extensions`);
    } else {
      candidateUrls.push(`${cleanBase}/api/extensions`);
      candidateUrls.push(`${cleanBase}/extensions`);
    }

    let successUrl: string | undefined;
    let nextPage: number | undefined;
    const requestedUrls: string[] = [];

    for (const urlStr of candidateUrls) {
      try {
        const urlObj = new URL(urlStr);
        if (query) urlObj.searchParams.set("query", query);
        if (category && category !== "All") urlObj.searchParams.set("category", category);
        // Toolchains share the catalog transport with Discover. The server
        // hides Runtime records by default, so request them explicitly once.
        urlObj.searchParams.set("includeRuntime", "true");
        urlObj.searchParams.set("limit", "256");
        urlObj.searchParams.set("page", String(page));
        requestedUrls.push(urlObj.toString());

        const res = await fetchWithTimeout(
          urlObj.toString(),
          {
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal,
          },
          2500,
        );

        if (res.ok) {
          let payload: unknown;
          try {
            payload = await res.json();
          } catch {
            offlineReason = "invalid-response";
            continue;
          }
          const list = extractMarketplaceItems(payload);
          if (list) {
            successUrl = urlStr;
            const catalogVerified =
              desktopAvailable() && res.headers.get("X-Aurona-Catalog-Verified") === "true";
            items = boundedCatalog(list).map((entry) => normalizeExtension(entry, catalogVerified));
            const record = isRecord(payload) ? payload : {};
            const pagination = isRecord(record.pagination) ? record.pagination : record;
            const total = pagination.total;
            if (
              typeof pagination.nextPage === "number" &&
              Number.isSafeInteger(pagination.nextPage) &&
              pagination.nextPage === page + 1
            )
              nextPage = pagination.nextPage;
            else if (
              typeof total === "number" &&
              Number.isSafeInteger(total) &&
              total >= 0 &&
              page * 256 < total
            )
              nextPage = page + 1;
            else if (pagination.hasMore === true || (list.length === 256 && total === undefined))
              nextPage = page + 1;
            break;
          }
          offlineReason = "invalid-response";
          continue;
        }
        offlineReason = "invalid-response";
      } catch (error) {
        if (signal?.aborted) throw error;
        offlineReason = "server-unreachable";
        // 继续尝试下一个候选地址
      }
    }

    if (successUrl) {
      source = "online";
      offlineReason = undefined;
      writeCachedCatalog(items);
    } else {
      source = "offline";
      items = page === 1 ? readCachedCatalog() : [];
      if (desktopAvailable()) {
        try {
          if (page === 1)
            for (const requestedUrl of requestedUrls) {
              const cached = await NetworkIPC.cachedCatalog(requestedUrl);
              const entries = extractMarketplaceItems(cached);
              if (entries) {
                const expired =
                  isRecord(cached) && isRecord(cached.cache) && cached.cache.expired === true;
                items = boundedCatalog(entries).map((entry) => ({
                  ...normalizeExtension(entry, !expired),
                  cacheExpired: expired,
                }));
                if (
                  isRecord(cached) &&
                  isRecord(cached.pagination) &&
                  cached.pagination.nextPage === page + 1
                )
                  nextPage = page + 1;
                break;
              }
            }
        } catch {
          /* Legacy cache remains available only for unverified browsing. */
        }
      }
    }

    // 同步本地已安装状态
    const installedById = new Map(
      installedDescriptors.map((descriptor) => [canonicalExtensionId(descriptor.id), descriptor]),
    );
    items = items.map((item) => {
      const installed = installedById.get(canonicalExtensionId(item.id));
      return {
        ...item,
        installed: Boolean(installed) || item.installed,
        installedVersion: installed?.version,
        updateAvailable: Boolean(installed && compareVersions(item.version, installed.version) > 0),
      };
    });

    // 本地过滤筛选
    if (query?.trim()) {
      const q = query.trim().toLowerCase();
      items = items.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          it.description.toLowerCase().includes(q) ||
          Object.values(it.displayName).some((name) => name.toLowerCase().includes(q)) ||
          it.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    if (category && category !== "All") {
      items = items.filter((it) => it.category.toLowerCase() === category.toLowerCase());
    }

    return { items, source, serverUrl, offlineReason, nextPage };
  },

  async listExtensions(
    query?: string,
    category?: string,
    installedDescriptors: ExtensionDescriptor[] = [],
  ): Promise<MarketplaceExtensionItem[]> {
    const result = await this.fetchMarketplace(query, category, installedDescriptors);
    return result.items;
  },

  async fetchExtensionDetail(id: string): Promise<MarketplaceExtensionItem | null> {
    id = canonicalExtensionId(id);
    const serverUrl = await this.getServerUrl();
    const res = await requestCandidateUrls<Record<string, unknown>>(
      serverUrl,
      `extensions/${encodeURIComponent(id)}`,
    );

    if (!res?.data) {
      return readCachedCatalog().find((item) => item.id === id) || null;
    }
    const raw = (res.data.data as Record<string, unknown>) || res.data;
    const item = normalizeExtension(raw);
    const cached = readCachedCatalog().filter((entry) => entry.id !== id);
    writeCachedCatalog([...cached, item]);
    return item;
  },

  async fetchReviews(id: string): Promise<ReviewsResponse | null> {
    id = canonicalExtensionId(id);
    const serverUrl = await this.getServerUrl();
    const authHeaders = await marketplaceAuthHeaders(serverUrl);
    const res = await requestCandidateUrls<ReviewsResponse>(
      serverUrl,
      `extensions/${encodeURIComponent(id)}/reviews`,
      { headers: authHeaders },
    );
    if (!res?.data) return null;
    return res.data;
  },

  async fetchRuntimeMetadata(runtimeType: string): Promise<RuntimeMetadataItem | null> {
    const serverUrl = await this.getServerUrl();
    const res = await requestCandidateUrls<Record<string, unknown>>(
      serverUrl,
      `runtimes/${encodeURIComponent(runtimeType)}/latest`,
    );
    if (!res?.data) return null;
    const raw = isRecord(res.data.data) ? res.data.data : res.data;
    if (!isRecord(raw)) return null;
    return {
      runtimeType:
        typeof raw.runtimeType === "string" && raw.runtimeType.trim()
          ? raw.runtimeType
          : runtimeType,
      runtimeVersion: typeof raw.version === "string" ? raw.version : undefined,
      fileSize:
        typeof raw.fileSizeFormatted === "string"
          ? raw.fileSizeFormatted
          : typeof raw.fileSize === "string"
            ? raw.fileSize
            : undefined,
      sha256: typeof raw.sha256 === "string" ? raw.sha256 : undefined,
      downloadUrl:
        typeof raw.downloadUrl === "string"
          ? absoluteMarketplaceUrl(res.url, raw.downloadUrl)
          : undefined,
    };
  },

  async submitReview(
    id: string,
    rating: number,
    body: string,
    token?: string,
  ): Promise<{ success: boolean; message?: string; review?: ReviewItem }> {
    id = canonicalExtensionId(id);
    const serverUrl = await this.getServerUrl();
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : await marketplaceAuthHeaders(serverUrl);
    const res = await requestCandidateUrls<{
      success: boolean;
      data?: ReviewItem;
      message?: string;
    }>(serverUrl, `extensions/${encodeURIComponent(id)}/reviews`, {
      method: "POST",
      body: JSON.stringify({ rating, body }),
      headers,
    });

    if (!res?.data?.success) {
      return { success: false, message: res?.data?.message || "提交评价失败" };
    }
    return { success: true, review: res.data.data };
  },

  async markReviewHelpful(
    id: string,
    reviewId: string,
  ): Promise<{ success: boolean; helpfulCount?: number }> {
    id = canonicalExtensionId(id);
    const serverUrl = await this.getServerUrl();
    const headers = await marketplaceAuthHeaders(serverUrl);
    const res = await requestCandidateUrls<{ success: boolean; helpfulCount?: number }>(
      serverUrl,
      `extensions/${encodeURIComponent(id)}/reviews/${encodeURIComponent(reviewId)}/helpful`,
      { method: "POST", headers },
    );
    return {
      success: Boolean(res?.data?.success),
      helpfulCount: res?.data?.helpfulCount,
    };
  },

  async checkStarStatus(id: string): Promise<{ isStarred: boolean; starCount: number }> {
    id = canonicalExtensionId(id);
    const serverUrl = await this.getServerUrl();
    const headers = await marketplaceAuthHeaders(serverUrl);
    const res = await requestCandidateUrls<{
      success: boolean;
      isStarred: boolean;
      starCount: number;
    }>(serverUrl, `extensions/${encodeURIComponent(id)}/star/status`, { headers });
    return {
      isStarred: Boolean(res?.data?.isStarred),
      starCount: res?.data?.starCount || 0,
    };
  },

  async toggleStar(
    id: string,
    token?: string,
  ): Promise<{ isStarred: boolean; starCount: number; success: boolean }> {
    id = canonicalExtensionId(id);
    const serverUrl = await this.getServerUrl();
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : await marketplaceAuthHeaders(serverUrl);
    const res = await requestCandidateUrls<{
      success: boolean;
      isStarred: boolean;
      starCount: number;
      message?: string;
    }>(serverUrl, `extensions/${encodeURIComponent(id)}/star`, {
      method: "POST",
      headers,
    });

    if (!res?.data?.success) {
      throw new Error(res?.data?.message || "请先登录 Aurona Account");
    }
    return {
      success: Boolean(res?.data?.success),
      isStarred: Boolean(res?.data?.isStarred),
      starCount: res?.data?.starCount || 0,
    };
  },

  async fetchRankings(): Promise<MarketplaceRankingResult | null> {
    const serverUrl = await this.getServerUrl();
    const res = await requestCandidateUrls<{
      success: boolean;
      data: {
        topDownloaded: Record<string, unknown>[];
        topDownloads?: Record<string, unknown>[];
        topRated: Record<string, unknown>[];
        topStarred: Record<string, unknown>[];
        trending: Record<string, unknown>[];
      };
    }>(serverUrl, "extensions/ranking");

    if (!res?.data?.data) return null;
    const { topDownloaded, topDownloads, topRated, topStarred, trending } = res.data.data;
    const downloads = topDownloads ?? topDownloaded ?? [];
    return {
      topDownloaded: boundedCatalog(downloads).map((entry) => normalizeExtension(entry)),
      topDownloads: boundedCatalog(downloads).map((entry) => normalizeExtension(entry)),
      topRated: boundedCatalog(topRated || []).map((entry) => normalizeExtension(entry)),
      topStarred: boundedCatalog(topStarred || []).map((entry) => normalizeExtension(entry)),
      trending: boundedCatalog(trending || []).map((entry) => normalizeExtension(entry)),
    };
  },

  async getDownloadUrl(id: string, version?: string): Promise<string> {
    id = canonicalExtensionId(id);
    const serverUrl = await this.getServerUrl();
    const cleanBase = serverUrl.trim().replace(/\/+$/, "");
    const base =
      cleanBase.endsWith("/api") || cleanBase.includes("/api/") ? cleanBase : `${cleanBase}/api`;
    const concreteVersion =
      version && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? version : undefined;
    if (concreteVersion) {
      return `${base}/extensions/${encodeURIComponent(id)}/versions/${encodeURIComponent(concreteVersion)}/download`;
    }
    return `${base}/extensions/${encodeURIComponent(id)}/download`;
  },

  isNewerVersion(remoteVersion: string, installedVersion: string): boolean {
    return compareVersions(remoteVersion, installedVersion) > 0;
  },

  async fetchLspServers(language?: string): Promise<MarketplaceExtensionItem[]> {
    const serverUrl = await this.getServerUrl();
    let path = "extensions?kind=lsp";
    if (language) {
      path += `&language=${encodeURIComponent(language)}`;
    }
    const res = await requestCandidateUrls<Record<string, unknown>>(serverUrl, path);
    if (!res?.data) return [];
    const list = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.data)
        ? res.data.data
        : [];
    return boundedCatalog(list as Record<string, unknown>[]).map((entry) =>
      normalizeExtension(entry),
    );
  },
};

export const MarketplaceService = {
  ...MarketplaceCatalog,
  ...createMarketplaceInstaller(MarketplaceCatalog),
};
