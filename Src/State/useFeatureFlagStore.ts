import { create } from "zustand";
import { OFFICIAL_FEATURE_FLAGS } from "../Foundation/FeatureFlags/FeatureFlagRegistry";
import { FeatureFlagService } from "../Foundation/FeatureFlags/FeatureFlagService";
import type { FeatureFlagDefinition } from "../Foundation/Types/FeatureFlags";

interface FeatureFlagStoreState {
  flags: Record<string, boolean>;
  definitions: FeatureFlagDefinition[];
  isFeatureEnabled(flagId: string): boolean;
}

export const useFeatureFlagStore = create<FeatureFlagStoreState>((_set, get) => ({
  flags: FeatureFlagService.getAllFlags(),
  definitions: OFFICIAL_FEATURE_FLAGS,
  isFeatureEnabled(flagId: string): boolean {
    return get().flags[flagId] ?? FeatureFlagService.isEnabled(flagId);
  },
}));
