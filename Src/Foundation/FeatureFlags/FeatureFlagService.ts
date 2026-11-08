import { FEATURE_FLAG_MAP, OFFICIAL_FEATURE_FLAGS } from "./FeatureFlagRegistry";

/** Build defaults apply uniformly to every installation. */
export const FeatureFlagService = {
  isEnabled(flagId: string): boolean {
    return FEATURE_FLAG_MAP.get(flagId)?.defaultEnabled ?? false;
  },

  getAllFlags(): Record<string, boolean> {
    return Object.fromEntries(OFFICIAL_FEATURE_FLAGS.map((flag) => [flag.id, flag.defaultEnabled]));
  },
};
