import type { ExtensionDescriptor } from "../../../Foundation/IPC/ExtensionCommands";
import { UserConfigStore } from "../../../Foundation/Storage/UserConfigStore";

export const DEFAULT_MARKETPLACE_URL = "https://marketplace.aurona.cc/api";
export const LOCAL_DEV_MARKETPLACE_URL = "http://127.0.0.1:5219/api";

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
  verified?: boolean;
  featured?: boolean;
  readme?: string;
  installed?: boolean;
  enabled?: boolean;
  packageType: "aurx" | "vsix";
}

export type MarketplaceSourceStatus = "online" | "offline";

export interface MarketplaceFetchResult {
  items: MarketplaceExtensionItem[];
  source: MarketplaceSourceStatus;
  serverUrl: string;
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
    rating: 5.0,
    icon: undefined,
    verified: true,
    installed: true,
    enabled: true,
    packageType:
      descriptor.id.startsWith("vscode-") || descriptor.id.endsWith(".vsix") ? "vsix" : "aurx",
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

  return {
    id: String(raw.id || raw.name || ""),
    name: String(raw.name || raw.id || ""),
    displayName: displayNameMap,
    publisher: publisherName,
    version: String(raw.version || "1.0.0"),
    description: String(raw.description || ""),
    displayDescription: displayDescMap,
    category: String(raw.category || "Developer Tools"),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    downloads: typeof raw.downloads === "number" ? raw.downloads : 100,
    rating: typeof raw.rating === "number" ? raw.rating : 5.0,
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    verified: isVerified,
    featured: Boolean(raw.featured),
    readme: typeof raw.readme === "string" ? raw.readme : undefined,
    installed: Boolean(raw.installed),
    enabled: raw.enabled !== false,
    packageType: raw.packageType === "vsix" ? "vsix" : "aurx",
  };
}

export const MarketplaceService = {
  /**
   * 获取当前配置的 Marketplace 服务器地址
   */
  async getServerUrl(): Promise<string> {
    const config = await UserConfigStore.get();
    return config.marketplaceServerUrl?.trim() || DEFAULT_MARKETPLACE_URL;
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
  /**
   * 构造并自适应探测候选请求地址（同时兼容带 /api 与不带 /api 的各类市场服务）
   */
  async fetchMarketplace(
    query?: string,
    category?: string,
    installedDescriptors: ExtensionDescriptor[] = [],
  ): Promise<MarketplaceFetchResult> {
    const serverUrl = await this.getServerUrl();
    let items: MarketplaceExtensionItem[] = [];
    let source: MarketplaceSourceStatus = "offline";

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
          signal: AbortSignal.timeout(2000),
        });

        if (res.ok) {
          successResponse = res;
          break;
        }
      } catch {
        // 继续尝试下一个候选地址
      }
    }

    if (successResponse) {
      source = "online";
      try {
        const json = await successResponse.json();
        const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        items = list.map(normalizeExtension);
      } catch {
        items = [];
      }
    } else {
      source = "offline";
      items = [];
    }

    // 同步本地已安装状态
    const installedIds = new Set(installedDescriptors.map((d) => d.id));
    items = items.map((item) => ({
      ...item,
      installed: installedIds.has(item.id) || item.installed,
    }));

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

    return { items, source, serverUrl };
  },

  async listExtensions(
    query?: string,
    category?: string,
    installedDescriptors: ExtensionDescriptor[] = [],
  ): Promise<MarketplaceExtensionItem[]> {
    const result = await this.fetchMarketplace(query, category, installedDescriptors);
    return result.items;
  },
};
