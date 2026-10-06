import { describe, expect, it } from "vitest";
import type { AiPreferences, AiProfile } from "../Foundation/Types/Config";
import { isAiProfileUsable, needsAiProfileMigration, resolveAiProfiles } from "./AiProfiles";

const profile = (id: string): AiProfile => ({
  id,
  name: id,
  baseUrl: "https://api.example.com/v1",
  model: "model",
  credentialId: `${id}.credential`,
  hasCredential: true,
  protocol: "responses",
});

describe("resolveAiProfiles", () => {
  it("has no active profile before configuration", () => {
    expect(resolveAiProfiles(undefined)).toEqual({
      profiles: [],
      active: null,
      activeIdValid: false,
    });
  });

  it("never promotes legacy plaintext into an active frontend profile", () => {
    const ai: AiPreferences = {
      baseUrl: "https://api.example.com",
      apiKey: "secret",
      model: "model",
    };
    expect(resolveAiProfiles(ai).active).toBeNull();
    const legacy = { ...profile("legacy"), apiKey: "secret" };
    const resolved = resolveAiProfiles({ profiles: [legacy] });
    expect(resolved.active).toEqual(profile("legacy"));
    expect(JSON.stringify(resolved)).not.toContain("secret");
    expect(resolved.active).not.toHaveProperty("apiKey");
  });

  it("selects active metadata and falls back when its ID disappears", () => {
    const profiles = [profile("p1"), profile("p2")];
    expect(resolveAiProfiles({ profiles, activeProfileId: "p2" }).activeIdValid).toBe(true);
    expect(resolveAiProfiles({ profiles, activeProfileId: "p2" }).active?.id).toBe("p2");
    expect(resolveAiProfiles({ profiles, activeProfileId: "gone" })).toMatchObject({
      active: profile("p1"),
      activeIdValid: false,
    });
  });

  it("rejects malformed and duplicate metadata without accepting raw credentials", () => {
    const resolved = resolveAiProfiles({
      profiles: [
        null,
        {},
        { ...profile(""), id: "" },
        profile("dup"),
        profile("dup"),
        { id: "legacy", baseUrl: "https://example.com", apiKey: "secret" },
      ] as unknown as AiProfile[],
    });
    expect(resolved.profiles).toEqual([profile("dup")]);
  });
});

describe("profile availability and migration", () => {
  it("requires a nonempty endpoint, model and backend credential", () => {
    expect(isAiProfileUsable(profile("p"))).toBe(true);
    for (const invalid of [
      null,
      { ...profile("p"), baseUrl: " " },
      { ...profile("p"), model: " " },
      { ...profile("p"), credentialId: "" },
      { ...profile("p"), hasCredential: false },
    ])
      expect(isAiProfileUsable(invalid)).toBe(false);
  });

  it("detects both legacy credential formats even alongside migrated metadata", () => {
    expect(needsAiProfileMigration({ apiKey: "secret" })).toBe(true);
    const legacy = { ...profile("p"), apiKey: "secret" };
    expect(needsAiProfileMigration({ profiles: [legacy] })).toBe(true);
    expect(needsAiProfileMigration({ profiles: [profile("p")] })).toBe(false);
    expect(needsAiProfileMigration(undefined)).toBe(false);
  });
});
