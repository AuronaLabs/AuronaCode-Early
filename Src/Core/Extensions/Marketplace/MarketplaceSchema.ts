const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function object(raw: unknown, name: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > 64)
    throw new Error(`Invalid Marketplace ${name}`);
  return raw as Record<string, unknown>;
}

function strings(record: Record<string, unknown>, keys: readonly string[], limit = 8192): void {
  for (const key of keys)
    if (
      record[key] !== undefined &&
      (typeof record[key] !== "string" || (record[key] as string).length > limit)
    )
      throw new Error(`Invalid Marketplace ${key}`);
}

function stringList(raw: unknown, name: string, count: number, bytes: number): void {
  if (
    !Array.isArray(raw) ||
    raw.length > count ||
    raw.some((value) => typeof value !== "string" || value.length > bytes)
  )
    throw new Error(`Invalid Marketplace ${name}`);
}

function version(value: unknown): boolean {
  return typeof value === "string" && value.length <= 128 && VERSION.test(value);
}

function boundedJson(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (depth > 16 || ++budget.nodes > 4096) throw new Error("Marketplace metadata is too complex");
  if (Array.isArray(value)) {
    if (value.length > 256) throw new Error("Marketplace metadata array is too large");
    for (const child of value) boundedJson(child, depth + 1, budget);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(object(value, "metadata"))) {
      if (key.length > 256) throw new Error("Marketplace metadata key is too long");
      boundedJson(child, depth + 1, budget);
    }
  } else if (typeof value === "string" && value.length > 8192)
    throw new Error("Marketplace metadata string is too long");
}
export function validateMarketplaceRecord(raw: unknown): asserts raw is Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid Marketplace item");
  const record = raw as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    record.id.length > 128 ||
    !/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+$/.test(record.id)
  )
    throw new Error("Invalid Marketplace extension ID");
  if (!version(record.version)) throw new Error("Invalid Marketplace version");
  for (const key of [
    "name",
    "description",
    "category",
    "license",
    "fileSize",
    "fileSizeFormatted",
    "downloadUrl",
    "updatedAt",
    "icon",
    "publisherAvatar",
    "readme",
    "changelog",
  ]) {
    const value = record[key];
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== "string" ||
        value.length >
          (key === "readme" || key === "changelog"
            ? 1024 * 1024
            : key === "icon"
              ? 256 * 1024
              : 8192))
    )
      throw new Error(`Invalid Marketplace ${key}`);
  }
  for (const key of ["displayName", "displayDescription"]) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      if (value.length > 8192) throw new Error(`Invalid Marketplace ${key}`);
      continue;
    }
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length > 32 ||
      Object.values(value).some((value) => typeof value !== "string" || value.length > 8192)
    )
      throw new Error(`Invalid Marketplace ${key}`);
  }
  if (record.publisher !== undefined && record.publisher !== null) {
    if (typeof record.publisher === "string") {
      if (record.publisher.length > 256) throw new Error("Invalid publisher");
    } else if (
      typeof record.publisher !== "object" ||
      Array.isArray(record.publisher) ||
      Object.keys(record.publisher).length > 32
    )
      throw new Error("Invalid publisher");
    else {
      strings(
        record.publisher as Record<string, unknown>,
        ["displayName", "name", "avatar", "picture"],
        8192,
      );
      for (const [key, value] of Object.entries(record.publisher)) {
        if (["displayName", "name", "avatar", "picture"].includes(key) && typeof value !== "string")
          throw new Error("Invalid publisher field");
        if (key === "verified" && typeof value !== "boolean")
          throw new Error("Invalid publisher verification field");
      }
    }
  }
  if (
    record.tags !== undefined &&
    (!Array.isArray(record.tags) ||
      record.tags.length > 64 ||
      record.tags.some((tag) => typeof tag !== "string" || tag.length > 128))
  )
    throw new Error("Invalid Marketplace tags");
  for (const key of ["downloads", "rating", "reviewCount", "starCount", "securityScore"])
    if (
      record[key] !== undefined &&
      (typeof record[key] !== "number" ||
        !Number.isFinite(record[key]) ||
        (record[key] as number) < 0)
    )
      throw new Error(`Invalid Marketplace ${key}`);
  for (const key of ["verified", "featured", "installed", "enabled"])
    if (record[key] !== undefined && typeof record[key] !== "boolean")
      throw new Error(`Invalid Marketplace ${key}`);
  if (record.kind !== undefined && !["extension", "lsp", "runtime"].includes(record.kind as string))
    throw new Error("Invalid Marketplace kind");
  if (
    record.packageType !== undefined &&
    !["aurx", "vsix", "aurlsp"].includes(record.packageType as string)
  )
    throw new Error("Invalid Marketplace package type");
  if (record.rawPermissions !== undefined)
    stringList(record.rawPermissions, "rawPermissions", 64, 128);
  if (record.permissions !== undefined) {
    if (!Array.isArray(record.permissions) || record.permissions.length > 64)
      throw new Error("Invalid Marketplace permissions");
    for (const raw of record.permissions) {
      const permission = object(raw, "permission");
      strings(permission, ["id", "name", "description", "iconType", "level"]);
      if (typeof permission.id !== "string" || permission.id.length > 128)
        throw new Error("Invalid Marketplace permission ID");
    }
  }
  if (record.publishedVersions !== undefined) {
    if (!Array.isArray(record.publishedVersions) || record.publishedVersions.length > 256)
      throw new Error("Invalid Marketplace versions");
    for (const raw of record.publishedVersions) {
      const release = object(raw, "release");
      if (!version(release.version)) throw new Error("Invalid Marketplace release version");
      strings(release, [
        "minAuronaCodeVersion",
        "maxAuronaCodeVersion",
        "fileSizeFormatted",
        "sha256",
        "publishedAt",
        "downloadUrl",
      ]);
      for (const key of ["minAuronaCodeVersion", "maxAuronaCodeVersion"])
        if (release[key] !== undefined && !version(release[key]))
          throw new Error(`Invalid Marketplace ${key}`);
      if (release.sha256 !== undefined && !/^[0-9a-fA-F]{64}$/.test(release.sha256 as string))
        throw new Error("Invalid Marketplace release hash");
    }
  }
  if (record.lspMetadata !== undefined && record.lspMetadata !== null) {
    const lsp = object(record.lspMetadata, "LSP metadata");
    stringList(lsp.languages, "languages", 64, 128);
    strings(lsp, ["runtimeType", "minRuntimeVersion", "entry", "execMode"]);
    if (
      lsp.execMode !== undefined &&
      !["module", "commonjs", "binary"].includes(lsp.execMode as string)
    )
      throw new Error("Invalid Marketplace execution mode");
    if (lsp.defaultArgs !== undefined) stringList(lsp.defaultArgs, "arguments", 128, 4096);
    if (lsp.defaultSettings !== undefined) {
      object(lsp.defaultSettings, "LSP settings");
      boundedJson(lsp.defaultSettings);
    }
  }
  if (record.runtimeMetadata !== undefined && record.runtimeMetadata !== null) {
    const runtime = object(record.runtimeMetadata, "runtime metadata");
    strings(runtime, [
      "runtimeType",
      "runtimeVersion",
      "platform",
      "architecture",
      "binaryPath",
      "fileSize",
      "sha256",
      "downloadUrl",
    ]);
    if (runtime.runtimeVersion !== undefined && !version(runtime.runtimeVersion))
      throw new Error("Invalid Marketplace runtime version");
    if (runtime.sha256 !== undefined && !/^[0-9a-fA-F]{64}$/.test(runtime.sha256 as string))
      throw new Error("Invalid Marketplace runtime hash");
  }
}

export function boundedCatalog<T>(entries: T[]): T[] {
  if (entries.length > 1000)
    throw new Error("Marketplace catalog exceeds 1000 entries; use pagination");
  return entries;
}
