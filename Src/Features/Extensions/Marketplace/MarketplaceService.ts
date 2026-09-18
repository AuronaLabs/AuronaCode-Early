import { invokeDesktop } from "../../../Foundation/Desktop";
import { AccountAuthIPC } from "../../../Foundation/IPC/AccountAuthCommands";
import { type ExtensionDescriptor, ExtensionIPC } from "../../../Foundation/IPC/ExtensionCommands";
import {
  type InstalledToolchainSummary,
  LanguageServerIPC,
  type ToolchainsOverview,
} from "../../../Foundation/IPC/LanguageServerCommands";
import { UserConfigStore } from "../../../Foundation/Storage/UserConfigStore";
import { canonicalExtensionId, migrateExtensionRecords } from "../ExtensionId";

export const DEFAULT_MARKETPLACE_URL = "https://marketplace.aurona.cc/api";
export const LOCAL_DEV_MARKETPLACE_URL = "http://127.0.0.1:5219/api";

let cachedMarketplaceToken: string | null = null;
let cachedAuronaAccessToken: string | null = null;
const MARKETPLACE_CACHE_KEY = "aurona.marketplace.catalog.v1";

export interface MarketplaceRequestOptions {
  signal?: AbortSignal;
}

export type MarketplaceRequestInput = MarketplaceRequestOptions | AbortSignal;

function inputSignal(input?: MarketplaceRequestInput): AbortSignal | undefined {
  if (!input) return undefined;
  if (typeof AbortSignal !== "undefined" && input instanceof AbortSignal) return input;
  return "signal" in input ? input.signal : undefined;
}

interface HttpFetchBytesResult {
  data_b64: string;
  sha256?: string | null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function absoluteMarketplaceUrl(baseUrl: string, value: string): string {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

/** 官方市场渠道判定：仅该渠道强制 SHA-256 信任策略；本地开发/自定义服务器豁免。 */
export function isOfficialMarketplaceHost(serverUrl: string): boolean {
  try {
    return new URL(serverUrl).host === "marketplace.aurona.cc";
  } catch {
    return false;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const externalSignal = init.signal;
  if (externalSignal?.aborted) {
    throw externalSignal.reason ?? new DOMException("The request was aborted", "AbortError");
  }
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}

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
    if (!Array.isArray(parsed)) return [];
    const records = parsed.filter((item) => item && typeof item.id === "string");
    const migrated = migrateExtensionRecords(records);
    if (
      migrated.length !== records.length ||
      migrated.some((item, index) => item.id !== records[index]?.id)
    ) {
      writeCachedCatalog(migrated);
    }
    return migrated;
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

export interface LspMetadataItem {
  languages: string[];
  runtimeType: string;
  minRuntimeVersion?: string;
  entry: string;
  execMode?: "module" | "commonjs" | "binary";
  defaultArgs?: string[];
  defaultSettings?: Record<string, unknown>;
}

export interface RuntimeMetadataItem {
  runtimeType: string;
  runtimeVersion?: string;
  platform?: string;
  architecture?: string;
  binaryPath?: string;
  fileSize?: string;
  sha256?: string;
  downloadUrl?: string;
}

export interface MarketplaceExtensionItem {
  id: string;
  kind?: "extension" | "lsp" | "runtime";
  name: string;
  displayName: Record<string, string>;
  publisher: string;
  version: string;
  description: string;
  displayDescription: Record<string, string>;
  category: string;
  tags: string[];
  downloads?: number;
  rating?: number;
  icon?: string;
  publisherAvatar?: string;
  verified?: boolean;
  featured?: boolean;
  readme?: string;
  installed?: boolean;
  enabled?: boolean;
  packageType: "aurx" | "vsix" | "aurlsp";
  reviewCount?: number;
  starCount?: number;
  securityScore?: number;
  permissions?: PermissionItem[];
  rawPermissions?: string[];
  lspMetadata?: LspMetadataItem;
  runtimeMetadata?: RuntimeMetadataItem;
  license?: string;
  fileSize?: string;
  changelog?: string;
  downloadUrl?: string;
  publishedVersions?: PublishedVersionItem[];
  updatedAt?: string;
  isStarred?: boolean;
  installedVersion?: string;
  updateAvailable?: boolean;
  /** Present only for locally discovered toolchains; never treated as market metadata. */
  localToolchain?: InstalledToolchainSummary;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractMarketplaceItems(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    return value.every(isRecord) ? value : null;
  }
  if (!isRecord(value)) return null;
  const data = value.data;
  if (Array.isArray(data)) return data.every(isRecord) ? data : null;
  if (isRecord(data) && Array.isArray(data.items)) {
    return data.items.every(isRecord) ? data.items : null;
  }
  return null;
}

/**
 * 将本地加载/安装的 ExtensionDescriptor 转为统一的 Marketplace 展示对象
 */
export function descriptorToMarketplaceItem(
  descriptor: ExtensionDescriptor,
): MarketplaceExtensionItem {
  const id = canonicalExtensionId(descriptor.id);
  return {
    id,
    name: descriptor.name,
    displayName: descriptor.displayName || { "zh-CN": descriptor.name, en: descriptor.name },
    publisher: descriptor.publisher || "Local",
    version: descriptor.version || "0.1.0",
    description: descriptor.description || "",
    displayDescription: descriptor.displayDescription || {
      "zh-CN": descriptor.description || "",
      en: descriptor.description || "",
    },
    readme: descriptor.readme,
    changelog: descriptor.changelog,
    category: "Developer Tools",
    tags: ["installed", "local"],
    icon: undefined,
    verified: true,
    installed: true,
    enabled: true,
    packageType:
      descriptor.id.startsWith("vscode-") || descriptor.id.endsWith(".vsix") ? "vsix" : "aurx",
    permissions: [],
    rawPermissions: [],
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

  const rawKind = String(raw.kind || "").toLowerCase();
  const kind: "extension" | "lsp" | "runtime" =
    rawKind === "lsp" ? "lsp" : rawKind === "runtime" ? "runtime" : "extension";

  const lspMetadata =
    typeof raw.lspMetadata === "object" && raw.lspMetadata !== null
      ? (raw.lspMetadata as LspMetadataItem)
      : undefined;

  const runtimeMetadata =
    typeof raw.runtimeMetadata === "object" && raw.runtimeMetadata !== null
      ? (raw.runtimeMetadata as RuntimeMetadataItem)
      : undefined;

  const packageType =
    raw.packageType === "vsix"
      ? "vsix"
      : raw.packageType === "aurlsp" || kind === "lsp"
        ? "aurlsp"
        : "aurx";

  return {
    id: canonicalExtensionId(String(raw.id || raw.name || "")),
    kind,
    name: String(raw.name || raw.id || ""),
    displayName: displayNameMap,
    publisher: publisherName,
    publisherAvatar,
    version: String(raw.version || "未知版本"),
    description: String(raw.description || ""),
    displayDescription: displayDescMap,
    category: String(raw.category || (kind === "lsp" ? "LSP" : "Developer Tools")),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    downloads: typeof raw.downloads === "number" ? raw.downloads : undefined,
    rating:
      typeof raw.rating === "number" && typeof raw.reviewCount === "number" && raw.reviewCount > 0
        ? raw.rating
        : undefined,
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    verified: isVerified,
    featured: Boolean(raw.featured),
    readme: typeof raw.readme === "string" ? raw.readme : undefined,
    changelog: typeof raw.changelog === "string" ? raw.changelog : undefined,
    installed: Boolean(raw.installed),
    enabled: raw.enabled !== false,
    packageType,
    reviewCount: typeof raw.reviewCount === "number" ? raw.reviewCount : undefined,
    starCount: typeof raw.starCount === "number" ? raw.starCount : undefined,
    securityScore: typeof raw.securityScore === "number" ? raw.securityScore : undefined,
    permissions,
    rawPermissions,
    lspMetadata,
    runtimeMetadata,
    license: typeof raw.license === "string" ? raw.license : undefined,
    fileSize:
      typeof raw.fileSize === "string"
        ? raw.fileSize
        : typeof raw.fileSizeFormatted === "string"
          ? raw.fileSizeFormatted
          : undefined,
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
  } else {
    candidateUrls.push(`${cleanBase}/api/${cleanPath}`);
  }

  for (const urlStr of candidateUrls) {
    try {
      const res = await fetchWithTimeout(
        urlStr,
        {
          cache: "no-store",
          ...options,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(options?.headers || {}),
          },
        },
        3000,
      );

      if (res.ok) {
        const json = await res.json();
        return { data: json, url: urlStr };
      }
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      // 静默处理网络不可达
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
    options: MarketplaceRequestInput = {},
  ): Promise<MarketplaceFetchResult> {
    const signal = inputSignal(options);
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

    for (const urlStr of candidateUrls) {
      try {
        const urlObj = new URL(urlStr);
        if (query) urlObj.searchParams.set("query", query);
        if (category && category !== "All") urlObj.searchParams.set("category", category);
        // Toolchains share the catalog transport with Discover. The server
        // hides Runtime records by default, so request them explicitly once.
        urlObj.searchParams.set("includeRuntime", "true");

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
            items = list.map(normalizeExtension);
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
      items = readCachedCatalog();
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

  /**
   * 获取扩展的评价与评论列表
   */
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

  /** Reads the existing Runtime endpoint without inventing missing metadata. */
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

  /**
   * 提交扩展评分与评价
   */
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

  /**
   * 为某条评论标记有帮助 (点赞)
   */
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

  /**
   * 查询扩展星标收藏状态
   */
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

  /**
   * 切换扩展收藏状态
   */
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

  async installExtension(id: string, version?: string): Promise<ExtensionDescriptor> {
    id = canonicalExtensionId(id);
    const serverUrl = await this.getServerUrl();
    const url = await this.getDownloadUrl(id, version);
    // 统一走 Rust HTTP 客户端：与更新检查、工具链下载共用同一套代理偏好
    const result = await invokeDesktop<HttpFetchBytesResult>("http_fetch_bytes", { url });
    const sha256 = result.sha256 ?? undefined;
    // 供应链信任：官方渠道必须携带 SHA-256，缺失即拒装；本地开发/自定义服务器豁免
    if (!sha256 && isOfficialMarketplaceHost(serverUrl)) {
      throw new Error("官方市场下载缺少 SHA-256 校验值，已拒绝安装");
    }
    const bytes = Array.from(base64ToBytes(result.data_b64));
    const descriptor = await ExtensionIPC.install(bytes, sha256);
    return descriptor;
  },

  isNewerVersion(remoteVersion: string, installedVersion: string): boolean {
    return compareVersions(remoteVersion, installedVersion) > 0;
  },

  async uninstallExtension(id: string): Promise<void> {
    await ExtensionIPC.uninstall(canonicalExtensionId(id));
  },

  /**
   * 从 Marketplace 查询 LSP 语言服务包
   */
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
    return (list as Record<string, unknown>[]).map(normalizeExtension);
  },

  /**
   * 获取共享基础运行时下载绝对 URL
   */
  async getRuntimeDownloadUrl(runtimeType = "node"): Promise<string> {
    const serverUrl = await this.getServerUrl();
    const cleanBase = serverUrl.trim().replace(/\/+$/, "");
    const base =
      cleanBase.endsWith("/api") || cleanBase.includes("/api/") ? cleanBase : `${cleanBase}/api`;
    return `${base}/runtimes/${encodeURIComponent(runtimeType)}/download`;
  },

  async installRuntime(
    id: string,
    version?: string,
    onProgress?: (progress: number, stage: string) => void,
  ): Promise<InstalledToolchainSummary> {
    id = canonicalExtensionId(id);
    const detail = await this.fetchExtensionDetail(id);
    const metadata = detail?.runtimeMetadata;
    const runtimeType = metadata?.runtimeType ?? id;
    const serverUrl = await this.getServerUrl();
    const metadataDownloadUrl = metadata?.downloadUrl ?? detail?.downloadUrl;
    const downloadUrl = metadataDownloadUrl
      ? absoluteMarketplaceUrl(serverUrl, metadataDownloadUrl)
      : await this.getDownloadUrl(id, version);
    const downloadId = `runtime_${runtimeType}_${Date.now()}`;
    let unsub: (() => void) | undefined;
    if (onProgress) {
      unsub = await LanguageServerIPC.onDownloadProgress((progress) => {
        if (progress.downloadId === downloadId) onProgress(progress.percentage, progress.stage);
      });
    }
    try {
      return await LanguageServerIPC.installToolchainFromUrl(
        downloadId,
        downloadUrl,
        metadata?.sha256,
      );
    } finally {
      unsub?.();
    }
  },

  /**
   * 确保本地 APPDATA 已就绪指定类型的共享运行时 (默认 node)
   * 若未就绪，自动通过 Rust 原生异步流式下载官方公共基础运行时包并解压安装
   */
  async ensureSharedRuntime(
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
      await LanguageServerIPC.installToolchainFromUrl(downloadId, runtimeUrl);
    } catch {
      // 回退尝试常规扩展下载接口
      const fallbackUrl = await this.getDownloadUrl("auronalabs.runtime-node");
      await LanguageServerIPC.installToolchainFromUrl(downloadId, fallbackUrl);
    } finally {
      if (unsub) unsub();
    }
  },

  /**
   * 一键安装 LSP 语言服务包 (流式异步下载，0 内存压力)
   */
  async installLspServer(
    id: string,
    version?: string,
    onProgress?: (progress: number, stage: string) => void,
  ): Promise<InstalledToolchainSummary> {
    id = canonicalExtensionId(id);
    // 1. 获取该 LSP 详情与依赖的运行时
    const detail = await this.fetchExtensionDetail(id);
    const reqRuntime = detail?.lspMetadata?.runtimeType || "node";

    // 2. 如果需要共享 Node 运行时，先确保本地 APPDATA 已就绪
    if (reqRuntime === "node") {
      await this.ensureSharedRuntime("node", onProgress);
    }

    // 3. 下载并安装 LSP 语言服务归档包
    const downloadId = `lsp_${id}_${Date.now()}`;
    const downloadUrl = await this.getDownloadUrl(id, version);

    let unsub: (() => void) | undefined;
    if (onProgress) {
      unsub = await LanguageServerIPC.onDownloadProgress((p) => {
        if (p.downloadId === downloadId) {
          onProgress(p.percentage, p.stage);
        }
      });
    }

    try {
      const result = await LanguageServerIPC.installToolchainFromUrl(downloadId, downloadUrl);
      return result;
    } finally {
      if (unsub) unsub();
    }
  },

  /**
   * 卸载已安装的 LSP 语言服务
   */
  async uninstallLspServer(id: string): Promise<void> {
    await LanguageServerIPC.uninstallToolchain(canonicalExtensionId(id));
  },

  /**
   * 列出本地所有已安装的工具链与共享运行时
   */
  async listInstalledToolchains(): Promise<ToolchainsOverview> {
    return LanguageServerIPC.listToolchains();
  },

  /**
   * 卸载本地指定的共享运行时
   */
  async uninstallSharedRuntime(runtimeType: string): Promise<void> {
    await LanguageServerIPC.uninstallToolchainRuntime(runtimeType);
  },
};
