import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import { useFeatureFlagStore } from "./useFeatureFlagStore";

describe("useFeatureFlagStore", () => {
  beforeEach(async () => {
    vi.spyOn(UserConfigStore, "get").mockResolvedValue({});
    vi.spyOn(UserConfigStore, "set").mockResolvedValue();
    await useFeatureFlagStore.getState().setChannel("stable");
  });

  it("dynamically switches flags when channel changes", async () => {
    const store = useFeatureFlagStore.getState();
    await store.initialize();

    expect(store.channel).toBe("stable");
    expect(store.isFeatureEnabled("editor.minimap")).toBe(true);

    await store.setChannel("pioneer");
    expect(useFeatureFlagStore.getState().channel).toBe("pioneer");
    expect(useFeatureFlagStore.getState().isFeatureEnabled("marketplace.earlyPreview")).toBe(true);
  });
});
