import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserConfigStore } from "../Storage/UserConfigStore";
import { FeatureFlagService } from "./FeatureFlagService";

describe("FeatureFlagService", () => {
  beforeEach(async () => {
    vi.spyOn(UserConfigStore, "get").mockResolvedValue({});
    vi.spyOn(UserConfigStore, "set").mockResolvedValue();
    await FeatureFlagService.setChannel("stable");
  });

  it("evaluates flags strictly based on current release channel", async () => {
    await FeatureFlagService.setChannel("stable");
    expect(FeatureFlagService.isEnabled("editor.minimap")).toBe(true);
    expect(FeatureFlagService.isEnabled("editor.bracketPairColorization")).toBe(true);
    expect(FeatureFlagService.isEnabled("performance.asciiFastMetrics")).toBe(true);

    await FeatureFlagService.setChannel("pioneer");
    expect(FeatureFlagService.getChannel()).toBe("pioneer");
    expect(FeatureFlagService.isEnabled("editor.smoothCaret")).toBe(true);
    expect(FeatureFlagService.isEnabled("marketplace.earlyPreview")).toBe(true);
  });

  it("returns false for unknown feature flag IDs", () => {
    expect(FeatureFlagService.isEnabled("nonexistent.feature.id")).toBe(false);
  });
});
