export type PathPlatform = "windows" | "macos" | "linux";

const detectPlatform = (): PathPlatform => {
  const value = (typeof navigator !== "undefined" ? navigator.platform : "").toLowerCase();
  if (value.includes("mac")) return "macos";
  if (value.includes("linux")) return "linux";
  return "windows";
};

let currentPlatform: PathPlatform = detectPlatform();

/** 由应用启动流程在拿到真实平台信息后同步一次，保持 Utility 层零依赖。 */
export function setPathPlatform(platform: PathPlatform): void {
  currentPlatform = platform;
}

const resolvePlatform = (platform: PathPlatform | undefined): PathPlatform =>
  platform ?? currentPlatform;

const encodeSegments = (value: string) =>
  value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/**
 * 将 file URI 转换为当前平台（或显式指定平台）的原生路径。
 * Windows：处理盘符、反斜杠分隔符与 UNC authority；
 * macOS / Linux：保留 POSIX 绝对路径，不做反斜杠转换。
 */
export function uriToPath(uri: string, platform?: PathPlatform): string {
  const url = new URL(uri);
  const decoded = decodeURIComponent(url.pathname);
  if (resolvePlatform(platform) === "windows") {
    const withoutDrive = /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
    const withHost = url.host ? `//${url.host}${withoutDrive}` : withoutDrive;
    return withHost.replace(/\//g, "\\");
  }
  return decoded;
}

export function fileUriToPath(uri: string, platform?: PathPlatform): string | null {
  if (!uri.startsWith("file:")) return null;
  try {
    return uriToPath(uri, platform);
  } catch {
    return null;
  }
}

/**
 * 将原生路径转换为 file URI，平台语义与 uriToPath 保持一致。
 * Windows：`C:\a b.ts` → `file:///C:/a%20b.ts`，UNC 保留 authority；
 * POSIX：`/home/user/a.ts` → `file:///home/user/a.ts`。
 */
export function pathToFileUri(path: string, platform?: PathPlatform): string {
  const target = resolvePlatform(platform);
  const normalized = path.replace(/\\/g, "/");
  if (target === "windows") {
    if (normalized.startsWith("//")) {
      const rest = normalized.slice(2);
      const slash = rest.indexOf("/");
      const host = slash < 0 ? rest : rest.slice(0, slash);
      const tail = slash < 0 ? "" : rest.slice(slash);
      return `file://${host}${encodeSegments(tail).replace(/%3A/gi, ":")}`;
    }
    const withDrive = /^[A-Za-z]:/.test(normalized) ? `/${normalized}` : normalized;
    return `file://${encodeSegments(withDrive).replace(/%3A/gi, ":")}`;
  }
  return `file://${encodeSegments(normalized)}`;
}

/** 跨平台路径比较：Windows 忽略大小写并统一分隔符，POSIX 仅统一分隔符。 */
export function pathsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
  platform?: PathPlatform,
): boolean {
  if (!left || !right) return false;
  const normalize = (value: string) => {
    const slashed = value.replace(/\\/g, "/");
    if (resolvePlatform(platform) === "windows") return slashed.toLowerCase();
    return slashed;
  };
  return normalize(left) === normalize(right);
}
