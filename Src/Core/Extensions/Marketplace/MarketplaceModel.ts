import type { ExtensionDescriptor } from "../../../Foundation/IPC/ExtensionCommands";
import {
  canonicalExtensionId,
  migrateExtensionRecords,
} from "../../../Foundation/Types/ExtensionId";
import type {
  LspMetadataItem,
  MarketplaceExtensionItem,
  MarketplaceRequestInput,
  PermissionItem,
  PublishedVersionItem,
  RuntimeMetadataItem,
} from "./MarketplaceContracts";
import { boundedCatalog, validateMarketplaceRecord } from "./MarketplaceSchema";

const MARKETPLACE_CACHE_KEY = "aurona.marketplace.catalog.v1";

export function inputSignal(input?: MarketplaceRequestInput): AbortSignal | undefined {
  if (!input) return undefined;
  if (typeof AbortSignal !== "undefined" && input instanceof AbortSignal) return input;
  return "signal" in input ? input.signal : undefined;
}

export function absoluteMarketplaceUrl(baseUrl: string, value: string): string {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

export function compareVersions(left: string, right: string): number {
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

export function readCachedCatalog(): MarketplaceExtensionItem[] {
  try {
    const raw = localStorage.getItem(MARKETPLACE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(list)) return [];
    boundedCatalog(list);
    for (const entry of list) validateMarketplaceRecord(entry);
    const records = list;
    const migrated = migrateExtensionRecords(records);
    if (
      migrated.length !== records.length ||
      migrated.some((item, index) => item.id !== records[index]?.id)
    ) {
      writeCachedCatalog(migrated);
    }
    return migrated.map((item) => ({ ...item, verified: false, cacheExpired: true }));
  } catch {
    return [];
  }
}

export function writeCachedCatalog(items: MarketplaceExtensionItem[]): void {
  try {
    const content = JSON.stringify(boundedCatalog(items));
    if (new TextEncoder().encode(content).byteLength > 4 * 1024 * 1024) return;
    localStorage.setItem(MARKETPLACE_CACHE_KEY, content);
  } catch {
    // Offline cache is best effort and must not block Marketplace use.
  }
}

export function isOfficialMarketplaceHost(serverUrl: string): boolean {
  try {
    const url = new URL(serverUrl);
    return (
      url.protocol === "https:" &&
      url.host === "marketplace.aurona.cc" &&
      !url.username &&
      !url.password
    );
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractMarketplaceItems(value: unknown): Record<string, unknown>[] | null {
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
    verified: false,
    installed: true,
    enabled: true,
    packageType:
      descriptor.id.startsWith("vscode-") ||
      descriptor.id.endsWith("../../../Features/Extensions/Marketplace/.vsix")
        ? "vsix"
        : "aurx",
    permissions: [],
    rawPermissions: [...descriptor.permissions],
  };
}

export function normalizeExtension(
  raw: Record<string, unknown>,
  catalogVerified = false,
): MarketplaceExtensionItem {
  validateMarketplaceRecord(raw);
  const publisherObj =
    typeof raw.publisher === "object" && raw.publisher !== null
      ? (raw.publisher as Record<string, unknown>)
      : null;

  const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
  const publisherName = publisherObj
    ? text(publisherObj.displayName, text(publisherObj.name, "Unknown"))
    : text(raw.publisher, "Unknown");

  const isVerified =
    catalogVerified && (publisherObj ? publisherObj.verified === true : raw.verified === true);

  const displayNameMap: Record<string, string> =
    typeof raw.displayName === "object" && raw.displayName !== null
      ? (raw.displayName as Record<string, string>)
      : {
          "zh-CN": text(raw.displayName, text(raw.name)),
          en: text(raw.name, text(raw.displayName)),
        };

  const displayDescMap: Record<string, string> =
    typeof raw.displayDescription === "object" && raw.displayDescription !== null
      ? (raw.displayDescription as Record<string, string>)
      : {
          "zh-CN": text(raw.displayDescription, text(raw.description)),
          en: text(raw.description, text(raw.displayDescription)),
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

  const rawKind = text(raw.kind);
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
    id: canonicalExtensionId(text(raw.id)),
    kind,
    name: text(raw.name, text(raw.id)),
    displayName: displayNameMap,
    publisher: publisherName,
    publisherAvatar,
    version: text(raw.version),
    description: text(raw.description),
    displayDescription: displayDescMap,
    category: text(raw.category, kind === "lsp" ? "LSP" : "Developer Tools"),
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    downloads: typeof raw.downloads === "number" ? raw.downloads : undefined,
    rating:
      typeof raw.rating === "number" && typeof raw.reviewCount === "number" && raw.reviewCount > 0
        ? raw.rating
        : undefined,
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    verified: isVerified,
    featured: raw.featured === true,
    readme: typeof raw.readme === "string" ? raw.readme : undefined,
    changelog: typeof raw.changelog === "string" ? raw.changelog : undefined,
    installed: raw.installed === true,
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
