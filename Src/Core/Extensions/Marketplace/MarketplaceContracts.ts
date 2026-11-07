import type { InstalledToolchainSummary } from "../../../Foundation/IPC/LanguageServerCommands";

export interface MarketplaceRequestOptions {
  signal?: AbortSignal;
  page?: number;
}

export type MarketplaceRequestInput = MarketplaceRequestOptions | AbortSignal;

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
  cacheExpired?: boolean;
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
  nextPage?: number;
}

export interface MarketplaceRankingResult {
  topDownloaded: MarketplaceExtensionItem[];
  topDownloads: MarketplaceExtensionItem[];
  topRated: MarketplaceExtensionItem[];
  topStarred: MarketplaceExtensionItem[];
  trending: MarketplaceExtensionItem[];
}
