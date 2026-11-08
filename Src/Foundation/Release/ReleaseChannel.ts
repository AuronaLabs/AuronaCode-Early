/** Aurona version parsing, comparison and display formatting. */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  isPreRelease: boolean;
  preReleaseTag?: string;
  preReleaseIter?: number;
}

/**
 * 解析 Aurona Code 版本号字符串（支持语义化版本与 alpha 预发布标识）
 * 示例：
 * - "0.4.0" -> { major: 0, minor: 4, patch: 0, isPreRelease: false }
 * - "0.4.1-alpha.1" -> { major: 0, minor: 4, patch: 1, isPreRelease: true, preReleaseTag: "alpha", preReleaseIter: 1 }
 */
export function parseAuronaVersion(versionStr: string): ParsedVersion {
  const cleaned = versionStr.trim().replace(/^[vV]/, "").split("+")[0];
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
 * 2. 主/次/修订号相同时：正式版 > 预发布版（0.4.1 > 0.4.1-alpha.1）
 * 3. 预发布批次号比较：0.4.1-alpha.2 > 0.4.1-alpha.1
 * 4. 跨版本比较：0.4.1-alpha.1 > 0.4.0
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

  const identifiers = (version: string) => {
    const clean = version.trim().replace(/^[vV]/, "").split("+")[0];
    return clean.slice(clean.indexOf("-") + 1).split(".");
  };
  const left = identifiers(v1);
  const right = identifiers(v2);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumeric = /^[0-9]+$/.test(left[index]);
    const rightNumeric = /^[0-9]+$/.test(right[index]);
    if (leftNumeric && rightNumeric) {
      const a = BigInt(left[index]);
      const b = BigInt(right[index]);
      return a < b ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

/**
 * 将内部版本号渲染为面向用户的展示文案
 * 示例：
 * - "0.4.0" -> "0.4.0"
 * - "v0.4.0-alpha.4" -> "0.4.0 Alpha 4"
 * - "0.5.0-beta.2" -> "0.5.0 Beta 2"
 */
export function formatDisplayVersion(versionStr: string): string {
  const parsed = parseAuronaVersion(versionStr);
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  // 非法输入（如异步加载占位 "Loading..."）不强行渲染为 0.0.0
  if (!/\d/.test(versionStr)) {
    return versionStr;
  }
  if (!parsed.isPreRelease || !parsed.preReleaseTag) {
    return core;
  }
  const tag = parsed.preReleaseTag.charAt(0).toUpperCase() + parsed.preReleaseTag.slice(1);
  return parsed.preReleaseIter !== undefined
    ? `${core} ${tag}${parsed.preReleaseTag === "alpha" ? "" : " "}${parsed.preReleaseIter}`
    : `${core} ${tag}`;
}
