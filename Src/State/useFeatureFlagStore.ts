import { create } from "zustand";
import { OFFICIAL_FEATURE_FLAGS } from "../Foundation/FeatureFlags/FeatureFlagRegistry";
import { FeatureFlagService } from "../Foundation/FeatureFlags/FeatureFlagService";
import type { ReleaseChannel } from "../Foundation/Release/ReleaseChannel";
import type { FeatureFlagDefinition } from "../Foundation/Types/FeatureFlags";

interface FeatureFlagStoreState {
  channel: ReleaseChannel;
  flags: Record<string, boolean>;
  definitions: FeatureFlagDefinition[];
  initialized: boolean;
  initialize(): Promise<void>;
  setChannel(channel: ReleaseChannel): Promise<void>;
  isFeatureEnabled(flagId: string): boolean;
}

export const useFeatureFlagStore = create<FeatureFlagStoreState>((set, get) => ({
  channel: FeatureFlagService.getChannel(),
  flags: FeatureFlagService.getAllFlags(),
  definitions: OFFICIAL_FEATURE_FLAGS,
  initialized: false,

  async initialize() {
    if (get().initialized) return;
    await FeatureFlagService.init();
    set({
      channel: FeatureFlagService.getChannel(),
      flags: FeatureFlagService.getAllFlags(),
      initialized: true,
    });
  },

  async setChannel(channel: ReleaseChannel) {
    await FeatureFlagService.setChannel(channel);
    set({
      channel,
      flags: FeatureFlagService.getAllFlags(),
    });
  },

  isFeatureEnabled(flagId: string): boolean {
    return get().flags[flagId] ?? FeatureFlagService.isEnabled(flagId);
  },
}));
