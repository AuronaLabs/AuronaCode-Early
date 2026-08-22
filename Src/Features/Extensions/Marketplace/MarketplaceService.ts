import { AccountAuthIPC } from "../../../Foundation/IPC/AccountAuthCommands";
import { type ExtensionDescriptor, ExtensionIPC } from "../../../Foundation/IPC/ExtensionCommands";
import { UserConfigStore } from "../../../Foundation/Storage/UserConfigStore";

export const DEFAULT_MARKETPLACE_URL = "https://marketplace.aurona.cc/api";
export const LOCAL_DEV_MARKETPLACE_URL = "http://127.0.0.1:5219/api";

let cachedMarketplaceToken: string | null = null;
let cachedAuronaAccessToken: string | null = null;
const MARKETPLACE_CACHE_KEY = "aurona.marketplace.catalog.v1";

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : [0, 0, 0];
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function readCachedCatalog(): MarketplaceExtensionItem[] {
  try {
    const raw = localStorage.getItem(MARKETPLACE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item?.id !== "aurona.markdown" && item?.id !== "aurona.planner")
      : [];
  } catch {
    return [];
  }
}

function writeCachedCatalog(items: MarketplaceExtensionItem[]): void {
  try {
    localStorage.setItem(MARKETPLACE_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Offline cache is best effort and must not block Marketplace use.
  }
}

export interface PermissionItem {
  id: string;
  name: string;
  description: string;
  iconType: "folder" | "network" | "code" | "terminal" | "palette" | "cpu" | string;
  level: "normal" | "sensitive" | "critical" | string;
}

export interface PublishedVersionItem {
  version: string;
  minAuronaCodeVersion?: string;
  maxAuronaCodeVersion?: string;
  fileSizeFormatted?: string;
  sha256?: string;
  publishedAt?: string;
  downloadUrl?: string;
}

export interface ReviewItem {
  id: string;
  extensionId: string;
  userId?: string;
  userName: string;
  userAvatar?: string;
  rating: number;
  body: string;
  helpfulCount: number;
  reply?: {
    body: string;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt?: string;
}

export interface ReviewsResponse {
  total: number;
  ratingDistribution: Array<{ star: number; count: number }>;
  myReview?: ReviewItem | null;
  data: ReviewItem[];
}

export interface MarketplaceExtensionItem {
  id: string;
  name: string;
  displayName: Record<string, string>;
  publisher: string;
  version: string;
  description: string;
  displayDescription: Record<string, string>;
  category: string;
  tags: string[];
  downloads: number;
  rating: number;
  icon?: string;
  publisherAvatar?: string;
  verified?: boolean;
  featured?: boolean;
  readme?: string;
  installed?: boolean;
  enabled?: boolean;
  packageType: "aurx" | "vsix";
  reviewCount?: number;
  starCount?: number;
  securityScore?: number;
  permissions?: PermissionItem[];
  rawPermissions?: string[];
  license?: string;
  fileSize?: string;
  changelog?: string;
  downloadUrl?: string;
  publishedVersions?: PublishedVersionItem[];
  updatedAt?: string;
  isStarred?: boolean;
  installedVersion?: string;
  updateAvailable?: boolean;
}

export type MarketplaceSourceStatus = "online" | "offline";

export interface MarketplaceFetchResult {
  items: MarketplaceExtensionItem[];
  source: MarketplaceSourceStatus;
  serverUrl: string;
  offlineReason?: "server-unreachable" | "invalid-response";
}

export interface MarketplaceRankingResult {
  topDownloads: MarketplaceExtensionItem[];
  topRated: MarketplaceExtensionItem[];
  newlyAdded: MarketplaceExtensionItem[];
}

/**
 * 将本地加载/安装的 ExtensionDescriptor 转为统一的 Marketplace 展示对象
 */
export function descriptorToMarketplaceItem(
  descriptor: ExtensionDescriptor,
): MarketplaceExtensionItem {
  return {
    id: descriptor.id,
    name: descriptor.name,
    displayName: descriptor.displayName || { "zh-CN": descriptor.name, en: descriptor.name },
    publisher: descriptor.publisher || "Local",
    version: descriptor.version || "0.1.0",
    description: descriptor.description || "",
    displayDescription: descriptor.displayDescription || {
      "zh-CN": descriptor.description || "",
      en: descriptor.description || "",
    },
    category: "Developer Tools",
    tags: ["installed", "local"],
    downloads: 0,
    rating: 0,
    icon: undefined,
    verified: true,
    installed: true,
    enabled: true,
    packageType:
      descriptor.id.startsWith("vscode-") || descriptor.id.endsWith(".vsix") ? "vsix" : "aurx",
    reviewCount: 0,
    starCount: 0,
    securityScore: 100,
    permissions: [],
    rawPermissions: [],
    license: undefined,
    fileSize: "Local",
  };
}

function normalizeExtension(raw: Record<string, unknown>): MarketplaceExtensionItem {
  const publisherObj =
    typeof raw.publisher === "object" && raw.publisher !== null
      ? (raw.publisher as Record<string, unknown>)
      : null;

  const publisherName = publisherObj
    ? String(publisherObj.displayName || publisherObj.name || "Unknown")
    : String(raw.publisher || "Unknown");

  const isVerified = publisherObj ? Boolean(publisherObj.verified) : Boolean(raw.verified);

  const displayNameMap: Record<string, string> =
    typeof raw.displayName === "object" && raw.displayName !== null
      ? (raw.displayName as Record<string, string>)
      : {
          "zh-CN": String(raw.displayName || raw.name || ""),
          en: String(raw.name || raw.displayName || ""),
        };

  const displayDescMap: Record<string, string> =
    typeof raw.displayDescription === "object" && raw.displayDescription !== null
      ? (raw.displayDescription as Record<string, string>)
      : {
          "zh-CN": String(raw.displayDescription || raw.description || ""),
          en: String(raw.description || raw.displayDescription || ""),
        };

  const publisherAvatar = publisherObj
    ? typeof publisherObj.avatar === "string"
      ? publisherObj.avatar
      : typeof publisherObj.picture === "string"
        ? publisherObj.picture
        : undefined
    : typeof raw.publisherAvatar === "string"
      ? raw.publisherAvatar
      : undefined;

  const permissions = Array.isArray(raw.permissions)
    ? (raw.permissions as PermissionItem[])
    : undefined;

  const rawPermissions = Array.isArray(raw.rawPermissions)
    ? (raw.rawPermissions as string[])
    : undefined;

  const publishedVersions = Array.isArray(raw.publishedVersions)
    ? (raw.publishedVersions as PublishedVersionItem[])
    : undefined;

  return {
    id: String(raw.id || raw.name || ""),
    name: String(raw.name || raw.id || ""),
    displayName: displayNameMap,
    publisher: publisherName,
    publisherAvatar,
    version: String(raw.version || "未知版本"),
    description: String(raw.description || ""),
    displayDescription: displayDescMap,
    category: String(raw.category || "Developer Tools"),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    downloads: typeof raw.downloads === "number" ? raw.downloads : 0,
    rating:
      typeof raw.rating === "number" && typeof raw.reviewCount === "number" && raw.reviewCount > 0
        ? raw.rating
        : 0,
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    verified: isVerified,
    featured: Boolean(raw.featured),
    readme: typeof raw.readme === "string" ? raw.readme : undefined,
    changelog: typeof raw.changelog === "string" ? raw.changelog : undefined,
    installed: Boolean(raw.installed),
    enabled: raw.enabled !== false,
    packageType: raw.packageType === "vsix" ? "vsix" : "aurx",
    reviewCount: typeof raw.reviewCount === "number" ? raw.reviewCount : 0,
    starCount: typeof raw.starCount === "number" ? raw.starCount : 0,
    securityScore: typeof raw.securityScore === "number" ? raw.securityScore : undefined,
    permissions,
    rawPermissions,
    license: typeof raw.license === "string" ? raw.license : undefined,
    fileSize: typeof raw.fileSize === "string" ? raw.fileSize : undefined,
    downloadUrl: typeof raw.downloadUrl === "string" ? raw.downloadUrl : undefined,
    publishedVersions,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
}

async function requestCandidateUrls<T>(
  serverUrl: string,
  relativePath: string,
  options?: RequestInit,
): Promise<{ data: T; url: string } | null> {
  const cleanBase = serverUrl.trim().replace(/\/+$/, "");
  const cleanPath = relativePath.replace(/^\/+/, "");
  const candidateUrls: string[] = [];

  if (cleanBase.endsWith("/api") || cleanBase.includes("/api/")) {
    candidateUrls.push(`${cleanBase}/${cleanPath}`);
    candidateUrls.push(`${cleanBase.replace(/\/api\/?$/, "")}/${cleanPath}`);
  } else {
    candidateUrls.push(`${cleanBase}/api/${cleanPath}`);
    candidateUrls.push(`${cleanBase}/${cleanPath}`);
  }

  for (const urlStr of candidateUrls) {
    try {
      const res = await fetch(urlStr, {
        cache: "no-store",
        ...options,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(options?.headers || {}),
        },
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const json = await res.json();
        return { data: json, url: urlStr };
      }
    } catch {
      // 尝试下一个候选地址
    }
  }

  return null;
}

async function marketplaceAuthHeaders(serverUrl: string): Promise<Record<string, string>> {
  let accessToken: string | null = null;
  try {
    const status = await AccountAuthIPC.status();
    if (
      status.phase === "signedIn" &&
      status.expiresAtUnix !== null &&
      status.expiresAtUnix <= Math.floor(Date.now() / 1000) + 30
    ) {
      await AccountAuthIPC.refresh();
    }
    accessToken = await AccountAuthIPC.accessToken();
  } catch {
    return {};
  }
  if (!accessToken) {
    cachedAuronaAccessToken = null;
    cachedMarketplaceToken = null;
    return {};
  }
  if (cachedMarketplaceToken && cachedAuronaAccessToken === accessToken) {
    return { Authorization: `Bearer ${cachedMarketplaceToken}` };
  }
  const exchanged = await requestCandidateUrls<{
    success: boolean;
    token?: string;
  }>(serverUrl, "auth/token-exchange", {
    method: "POST",
    body: JSON.stringify({ access_token: accessToken }),
  });
  if (!exchanged?.data?.success || !exchanged.data.token) return {};
  cachedAuronaAccessToken = accessToken;
  cachedMarketplaceToken = exchanged.data.token;
  return { Authorization: `Bearer ${exchanged.data.token}` };
}

export const MarketplaceService = {
  /**
   * 获取当前配置的 Marketplace 服务器地址
   */
  async getServerUrl(): Promise<string> {
    const config = await UserConfigStore.get();
    const configured = config.marketplaceServerUrl?.trim();
    if (
      configured &&
      /^(https?:\/\/)?127\.0\.0\.1:5218\/?$/.test(configured.replace(/\/api\/?$/, ""))
    ) {
      await UserConfigStore.set({ marketplaceServerUrl: LOCAL_DEV_MARKETPLACE_URL });
      return LOCAL_DEV_MARKETPLACE_URL;
    }
    return configured || DEFAULT_MARKETPLACE_URL;
  },

  /**
   * 保存自定义 Marketplace 服务器地址
   */
  async setServerUrl(url: string): Promise<void> {
    await UserConfigStore.set({ marketplaceServerUrl: url.trim() });
  },

  /**
   * 检索插件市场列表（支持远程 API + 离线 Fallback 降级）
   */
  async fetchMarketplace(
    query?: string,
    category?: string,
    installedDescriptors: ExtensionDescriptor[] = [],
  ): Promise<MarketplaceFetchResult> {
    const serverUrl = await this.getServerUrl();
    let items: MarketplaceExtensionItem[] = [];
    let source: MarketplaceSourceStatus = "offline";
    let offlineReason: MarketplaceFetchResult["offlineReason"];

    const cleanBase = serverUrl.trim().replace(/\/+$/, "");
    const candidateUrls: string[] = [];

    if (cleanBase.endsWith("/api") || cleanBase.includes("/api/")) {
      candidateUrls.push(`${cleanBase}/extensions`);
      candidateUrls.push(`${cleanBase.replace(/\/api\/?$/, "")}/extensions`);
    } else {
      candidateUrls.push(`${cleanBase}/api/extensions`);
      candidateUrls.push(`${cleanBase}/extensions`);
    }

    let successResponse: Response | null = null;

    for (const urlStr of candidateUrls) {
      try {
        const urlObj = new URL(urlStr);
        if (query) urlObj.searchParams.set("query", query);
        if (category && category !== "All") urlObj.searchParams.set("category", category);

        const res = await fetch(urlObj.toString(), {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(2500),
        });

        if (res.ok) {
          successResponse = res;
          break;
        }
        offlineReason = "invalid-response";
      } catch {
        offlineReason = "server-unreachable";
        // 继续尝试下一个候选地址
      }
    }

    if (successResponse) {
      source = "online";
      offlineReason = undefined;
      try {
        const json = await successResponse.json();
        const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        items = list.map(normalizeExtension);
        writeCachedCatalog(items);
      } catch {
        items = [];
        offlineReason = "invalid-response";
      }
    } else {
      source = "offline";
      items = readCachedCatalog();
    }

    // 同步本地已安装状态
    const installedById = new Map(
      installedDescriptors.map((descriptor) => [descriptor.id, descriptor]),
    );
    items = items.map((item) => {
      const installed = installedById.get(item.id);
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

    return { items, source, serverUrl, offlineReason };
  },

  async listExtensions(
    query?: string,
    category?: string,
    installedDescriptors: ExtensionDescriptor[] = [],
  ): Promise<MarketplaceExtensionItem[]> {
    const result = await this.fetchMarketplace(query, category, installedDescriptors);
    return result.items;
  },

  /**
   * 获取指定扩展的完整详情信息
   */
  async fetchExtensionDetail(id: string): Promise<MarketplaceExtensionItem | null> {
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

  /**
   * 获取扩展的评价与评论列表
   */
  async fetchReviews(id: string): Promise<ReviewsResponse | null> {
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

  /**
   * 提交扩展评分与评价
   */
  async submitReview(
    id: string,
    rating: number,
    body: string,
    token?: string,
  ): Promise<{ success: boolean; message?: string; review?: ReviewItem }> {
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

  /**
   * 为某条评论标记有帮助 (点赞)
   */
  async markReviewHelpful(
    id: string,
    reviewId: string,
  ): Promise<{ success: boolean; helpfulCount?: number }> {
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

  /**
   * 查询扩展星标收藏状态
   */
  async checkStarStatus(id: string): Promise<{ isStarred: boolean; starCount: number }> {
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

  /**
   * 切换扩展收藏状态
   */
  async toggleStar(
    id: string,
    token?: string,
  ): Promise<{ isStarred: boolean; starCount: number; success: boolean }> {
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

  /**
   * 获取扩展排行榜
   */
  async fetchRankings(): Promise<MarketplaceRankingResult | null> {
    const serverUrl = await this.getServerUrl();
    const res = await requestCandidateUrls<{
      success: boolean;
      data: {
        topDownloads: Record<string, unknown>[];
        topRated: Record<string, unknown>[];
        newlyAdded: Record<string, unknown>[];
      };
    }>(serverUrl, "extensions/ranking");

    if (!res?.data?.data) return null;
    const { topDownloads, topRated, newlyAdded } = res.data.data;
    return {
      topDownloads: (topDownloads || []).map(normalizeExtension),
      topRated: (topRated || []).map(normalizeExtension),
      newlyAdded: (newlyAdded || []).map(normalizeExtension),
    };
  },

  /**
   * 获取指定扩展包下载真实绝对 URL
   */
  async getDownloadUrl(id: string, version?: string): Promise<string> {
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

  async installExtension(id: string, version?: string): Promise<ExtensionDescriptor> {
    const url = await this.getDownloadUrl(id, version);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`下载安装包失败 (${response.status})`);
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
    const descriptor = await ExtensionIPC.install(bytes);
    return descriptor;
  },

  isNewerVersion(remoteVersion: string, installedVersion: string): boolean {
    return compareVersions(remoteVersion, installedVersion) > 0;
  },

  async uninstallExtension(id: string): Promise<void> {
    await ExtensionIPC.uninstall(id);
  },
};
