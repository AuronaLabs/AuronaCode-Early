import { describe, expect, it } from "vitest";
import { FeatureFlagService } from "./FeatureFlagService";

describe("FeatureFlagService", () => {
  it("keeps shipped editor and extension capabilities enabled uniformly", () => {
    for (const id of [
      "editor.minimap",
      "editor.bracketPairColorization",
      "performance.asciiFastMetrics",
      "editor.smoothCaret",
      "extensions.vscodeCompatTranspiler",
    ]) {
      expect(FeatureFlagService.isEnabled(id)).toBe(true);
      expect(FeatureFlagService.getAllFlags()[id]).toBe(true);
    }
  });
  it("returns false for unknown feature flag IDs", () => {
    expect(FeatureFlagService.isEnabled("nonexistent.feature.id")).toBe(false);
  });
});
