import { describe, expect, it } from "vitest";
import type { AiPreferences } from "../Foundation/Types/Config";
import {
  isAiProfileUsable,
  LEGACY_AI_PROFILE_ID,
  needsAiProfileMigration,
  resolveAiProfiles,
} from "./AiProfiles";

describe("resolveAiProfiles", () => {
  it("无配置：profiles 为空且无激活档", () => {
    const resolved = resolveAiProfiles(undefined);
    expect(resolved.profiles).toEqual([]);
    expect(resolved.active).toBeNull();
  });

  it("旧单配置迁移：完整 baseUrl/apiKey 生成 default 档", () => {
    const ai: AiPreferences = {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    };
    const resolved = resolveAiProfiles(ai);
    expect(resolved.profiles).toHaveLength(1);
    expect(resolved.profiles[0]).toMatchObject({
      id: LEGACY_AI_PROFILE_ID,
      name: "",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });
    expect(resolved.active?.id).toBe(LEGACY_AI_PROFILE_ID);
  });

  it("旧字段不完整（缺 apiKey）：不迁移", () => {
    const resolved = resolveAiProfiles({ baseUrl: "https://x", apiKey: "  " });
    expect(resolved.profiles).toEqual([]);
    expect(resolved.active).toBeNull();
  });

  it("profiles 存在且 activeProfileId 命中", () => {
    const resolved = resolveAiProfiles({
      activeProfileId: "p2",
      profiles: [
        { id: "p1", name: "A", baseUrl: "https://a", apiKey: "k1", model: "m1" },
        { id: "p2", name: "B", baseUrl: "https://b", apiKey: "k2", model: "m2" },
      ],
    });
    expect(resolved.active?.id).toBe("p2");
    expect(resolved.activeIdValid).toBe(true);
  });

  it("activeProfileId 无效：回退 profiles[0]", () => {
    const resolved = resolveAiProfiles({
      activeProfileId: "gone",
      profiles: [{ id: "p1", name: "A", baseUrl: "https://a", apiKey: "k1", model: "m1" }],
    });
    expect(resolved.active?.id).toBe("p1");
    expect(resolved.activeIdValid).toBe(false);
  });

  it("脏数据清洗：非对象/缺 id/重复 id/缺字段被过滤", () => {
    const resolved = resolveAiProfiles({
      profiles: [
        null,
        { id: "", name: "x", baseUrl: "https://a", apiKey: "k" },
        { id: "dup", name: "x", baseUrl: "https://a", apiKey: "k", model: "m" },
        { id: "dup", name: "y", baseUrl: "https://b", apiKey: "k2", model: "m2" },
        { id: "ok", baseUrl: "https://c", apiKey: "k3" },
      ] as AiPreferences["profiles"],
    });
    expect(resolved.profiles.map((p) => p.id)).toEqual(["dup", "ok"]);
    expect(resolved.profiles[1].model).toBe("");
  });
});

describe("isAiProfileUsable", () => {
  it("baseUrl 与 apiKey 均非空才可用", () => {
    expect(isAiProfileUsable(null)).toBe(false);
    expect(isAiProfileUsable({ id: "p", name: "", baseUrl: " ", apiKey: "k", model: "" })).toBe(
      false,
    );
    expect(isAiProfileUsable({ id: "p", name: "", baseUrl: "u", apiKey: "k", model: "" })).toBe(
      true,
    );
  });
});

describe("needsAiProfileMigration", () => {
  it("旧单配置完整且无 profiles：需要迁移", () => {
    expect(needsAiProfileMigration({ baseUrl: "https://x", apiKey: "k" })).toBe(true);
  });

  it("已有 profiles：不迁移", () => {
    expect(
      needsAiProfileMigration({
        baseUrl: "https://x",
        apiKey: "k",
        profiles: [{ id: "p", name: "", baseUrl: "https://x", apiKey: "k", model: "" }],
      }),
    ).toBe(false);
  });

  it("完全未配置：不迁移", () => {
    expect(needsAiProfileMigration(undefined)).toBe(false);
    expect(needsAiProfileMigration({ baseUrl: "https://x" })).toBe(false);
  });
});
