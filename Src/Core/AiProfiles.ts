import type { AiPreferences, AiProfile } from "../Foundation/Types/Config";

/**
 * AI 多模型配置档解析（0.4.9）。
 *
 * 单一真源是 `ai.profiles`；0.4.8 及以前的单配置字段（provider/baseUrl/apiKey/model）
 * 仅作迁移源：profiles 为空且旧字段可用时迁移为 id="default" 的配置档。
 * activeProfileId 缺失或无效时回退 profiles[0]。
 */

/** 迁移生成的旧单配置档固定 id */
export const LEGACY_AI_PROFILE_ID = "default";

/** 单条配置档是否可用（baseUrl 与 apiKey 均非空；model 允许空串回退占位） */
export function isAiProfileUsable(profile: AiProfile | null | undefined): boolean {
  return Boolean(profile?.baseUrl.trim() && profile?.apiKey.trim());
}

/** 迁移旧单配置字段为配置档列表（旧字段不完整时返回空数组） */
function migrateLegacyProfile(ai: AiPreferences): AiProfile[] {
  const baseUrl = ai.baseUrl?.trim();
  const apiKey = ai.apiKey?.trim();
  if (!baseUrl || !apiKey) return [];
  return [
    {
      id: LEGACY_AI_PROFILE_ID,
      name: "",
      provider: ai.provider,
      baseUrl,
      apiKey,
      model: ai.model?.trim() ?? "",
    },
  ];
}

/** 清洗持久化数据中的 profiles（防手改/半损坏数据：过滤非法条目与空 id） */
function sanitizeProfiles(input: unknown): AiProfile[] {
  if (!Array.isArray(input)) return [];
  const result: AiProfile[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<AiProfile>;
    if (typeof item.id !== "string" || item.id.trim() === "" || seen.has(item.id)) continue;
    if (typeof item.baseUrl !== "string" || typeof item.apiKey !== "string") continue;
    seen.add(item.id);
    result.push({
      id: item.id,
      name: typeof item.name === "string" ? item.name : "",
      provider: item.provider,
      baseUrl: item.baseUrl,
      apiKey: item.apiKey,
      model: typeof item.model === "string" ? item.model : "",
    });
  }
  return result;
}

export interface ResolvedAiProfiles {
  /** 迁移 + 清洗后的配置档列表 */
  profiles: AiProfile[];
  /** 当前激活档（activeProfileId 命中 profiles，否则 profiles[0]；可能为 null） */
  active: AiProfile | null;
  /** activeProfileId 是否命中列表（未命中时调用方可选择回写） */
  activeIdValid: boolean;
}

/** 解析配置档：迁移旧单配置 → 清洗 → 解析激活档 */
export function resolveAiProfiles(ai: AiPreferences | undefined | null): ResolvedAiProfiles {
  const profiles = sanitizeProfiles(ai?.profiles);
  const migrated = profiles.length > 0 ? profiles : migrateLegacyProfile(ai ?? {});
  const activeId = ai?.activeProfileId?.trim();
  const active = (activeId && migrated.find((p) => p.id === activeId)) || migrated[0] || null;
  return {
    profiles: migrated,
    active,
    activeIdValid: Boolean(activeId && migrated.some((p) => p.id === activeId)),
  };
}

/**
 * 迁移检查：仅当「旧单配置存在且 profiles 为空」时执行一次性写回，
 * 让旧用户无感升级；已有多 profiles 或完全未配置时不写盘。
 */
export function needsAiProfileMigration(ai: AiPreferences | undefined | null): boolean {
  if (Array.isArray(ai?.profiles) && ai.profiles.length > 0) return false;
  return Boolean(ai?.baseUrl?.trim() && ai?.apiKey?.trim());
}
