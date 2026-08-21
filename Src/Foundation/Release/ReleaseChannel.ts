/**
 * Aurona Code 发行渠道与版本更新模型 (Release Channel & Version Comparator)
 * 对标 iOS Developer Beta 机制设计：
 * - 0.4.0 < 0.4.1-pioneer.1 < 0.4.1-pioneer.2 < 0.4.1
 * - Pioneer 客户端优先接收更新的 Pioneer 测试版；若当前无更新的测试版，但在远程有高于本地版本的 Stable 正式版，
 *   则升级到该正式版，且更新后客户端身份仍然留在 Pioneer 渠道。
 */

export type ReleaseChannel = "stable" | "pioneer";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  isPreRelease: boolean;
  preReleaseTag?: string;
  preReleaseIter?: number;
}

/**
 * 获取当前安装包在编译期定死的物理发行渠道
 */
export function getBuildChannel(): ReleaseChannel {
  const envChannel =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env.VITE_AURONA_CHANNEL as string | undefined)
      : undefined;

  if (envChannel === "pioneer") {
    return "pioneer";
  }
  return "stable";
}

/**
 * 判定指定版本或当前构建版本是否属于 Pioneer 先锋构建版本（物理版本，非运行时配置）
 */
export function isPioneerBuild(versionStr?: string): boolean {
  if (getBuildChannel() === "pioneer") {
    return true;
  }
  if (versionStr) {
    const parsed = parseAuronaVersion(versionStr);
    return parsed.isPreRelease && parsed.preReleaseTag === "pioneer";
  }
  return false;
}

/**
 * 解析 Aurona Code 版本号字符串（支持语义化版本与 pioneer 预发布标识）
 * 示例：
 * - "0.4.0" -> { major: 0, minor: 4, patch: 0, isPreRelease: false }
 * - "0.4.1-pioneer.1" -> { major: 0, minor: 4, patch: 1, isPreRelease: true, preReleaseTag: "pioneer", preReleaseIter: 1 }
 */
export function parseAuronaVersion(versionStr: string): ParsedVersion {
  const cleaned = versionStr.trim().replace(/^v/, "");
  const [corePart, prePart] = cleaned.split("-");
  const coreNums = corePart.split(".").map((n) => Number.parseInt(n, 10) || 0);

  const major = coreNums[0] ?? 0;
  const minor = coreNums[1] ?? 0;
  const patch = coreNums[2] ?? 0;

  if (!prePart) {
    return { major, minor, patch, isPreRelease: false };
  }

  const [tag, iterStr] = prePart.split(".");
  const preReleaseIter = iterStr !== undefined ? Number.parseInt(iterStr, 10) || 0 : undefined;

  return {
    major,
    minor,
    patch,
    isPreRelease: true,
    preReleaseTag: tag,
    preReleaseIter,
  };
}

/**
 * 比较两个版本号的大小
 * 返回值：
 * - > 0: v1 > v2
 * - < 0: v1 < v2
 * - = 0: v1 === v2
 *
 * 排序准则（完全符合 SemVer 2.0.0）：
 * 1. 主/次/修订号比较：0.4.1 > 0.4.0
 * 2. 主/次/修订号相同时：正式版 > 预发布版（0.4.1 > 0.4.1-pioneer.1）
 * 3. 预发布批次号比较：0.4.1-pioneer.2 > 0.4.1-pioneer.1
 * 4. 跨版本比较：0.4.1-pioneer.1 > 0.4.0
 */
export function compareAuronaVersions(v1: string, v2: string): number {
  const p1 = parseAuronaVersion(v1);
  const p2 = parseAuronaVersion(v2);

  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  if (p1.patch !== p2.patch) return p1.patch - p2.patch;

  // 基础版本相同时：没有 preRelease（正式版）大于任何 preRelease 版
  if (!p1.isPreRelease && p2.isPreRelease) return 1;
  if (p1.isPreRelease && !p2.isPreRelease) return -1;
  if (!p1.isPreRelease && !p2.isPreRelease) return 0;

  // 两者都是 preRelease
  const iter1 = p1.preReleaseIter ?? 0;
  const iter2 = p2.preReleaseIter ?? 0;
  return iter1 - iter2;
}

export interface AvailableRemoteVersion {
  version: string;
  channel: ReleaseChannel;
  downloadUrl?: string;
  releaseNotes?: string;
}

/**
 * iOS Developer Beta 风格的目标更新决议算法
 * @param clientChannel 客户端所在渠道（"stable" | "pioneer"）
 * @param currentVersion 客户端当前版本（如 "0.4.1-pioneer.1"）
 * @param remotes 远程所有可用发布的版本列表
 * @returns 应更新的目标版本对象（若无可用更新返回 null）
 */
export function resolveTargetUpdateVersion(
  clientChannel: ReleaseChannel,
  currentVersion: string,
  remotes: AvailableRemoteVersion[],
): AvailableRemoteVersion | null {
  if (remotes.length === 0) return null;

  // 1. 如果客户端是 Stable 渠道：只允许安装 Stable 正式版本
  if (clientChannel === "stable") {
    const stableCandidates = remotes
      .filter((r) => r.channel === "stable" && !parseAuronaVersion(r.version).isPreRelease)
      .filter((r) => compareAuronaVersions(r.version, currentVersion) > 0)
      .sort((a, b) => compareAuronaVersions(b.version, a.version));

    return stableCandidates[0] ?? null;
  }

  // 2. 如果客户端是 Pioneer 渠道：
  // 先找所有高于本地的候选版本（包含 Pioneer 与 Stable）
  const eligibleCandidates = remotes
    .filter((r) => compareAuronaVersions(r.version, currentVersion) > 0)
    .sort((a, b) => compareAuronaVersions(b.version, a.version));

  if (eligibleCandidates.length === 0) return null;

  // 返回最高版本（无论最高的是新的 Pioneer 还是已发布的正式 Stable）
  return eligibleCandidates[0];
}
