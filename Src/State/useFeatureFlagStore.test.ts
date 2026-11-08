import { describe, expect, it } from "vitest";
import { useFeatureFlagStore } from "./useFeatureFlagStore";

describe("useFeatureFlagStore", () => {
  it("makes shipped capabilities available without loading user configuration", () => {
    const store = useFeatureFlagStore.getState();
    expect(store.isFeatureEnabled("editor.minimap")).toBe(true);
    expect(store.isFeatureEnabled("extensions.vscodeCompatTranspiler")).toBe(true);
    expect(store.isFeatureEnabled("unknown.feature")).toBe(false);
  });
});
