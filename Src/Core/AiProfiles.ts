import type { AiPreferences, AiProfile } from "../Foundation/Types/Config";

// Rust completes credential migration before profile metadata reaches the UI.
export function isAiProfileUsable(profile: AiProfile | null | undefined): boolean {
  return Boolean(
    profile?.baseUrl.trim() &&
      profile?.model.trim() &&
      profile?.hasCredential &&
      profile?.credentialId,
  );
}

function sanitizeProfiles(input: unknown): AiProfile[] {
  if (!Array.isArray(input)) return [];
  const result: AiProfile[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<AiProfile>;
    if (
      typeof item.id !== "string" ||
      !item.id.trim() ||
      seen.has(item.id) ||
      typeof item.baseUrl !== "string" ||
      typeof item.credentialId !== "string"
    )
      continue;
    seen.add(item.id);
    result.push({
      id: item.id,
      name: typeof item.name === "string" ? item.name : "",
      provider: item.provider,
      baseUrl: item.baseUrl,
      credentialId: item.credentialId,
      hasCredential: item.hasCredential === true,
      model: typeof item.model === "string" ? item.model : "",
      protocol: "responses",
    });
  }
  return result;
}

export interface ResolvedAiProfiles {
  profiles: AiProfile[];
  active: AiProfile | null;
  activeIdValid: boolean;
}

export function resolveAiProfiles(ai: AiPreferences | undefined | null): ResolvedAiProfiles {
  const profiles = sanitizeProfiles(ai?.profiles);
  const activeId = ai?.activeProfileId?.trim();
  const selected = activeId ? profiles.find((profile) => profile.id === activeId) : undefined;
  return { profiles, active: selected ?? profiles[0] ?? null, activeIdValid: Boolean(selected) };
}

export function needsAiProfileMigration(ai: AiPreferences | undefined | null): boolean {
  return Boolean(
    ai?.apiKey?.trim() ||
      ai?.profiles?.some(
        (profile) =>
          "apiKey" in profile && typeof profile.apiKey === "string" && profile.apiKey.trim(),
      ),
  );
}
