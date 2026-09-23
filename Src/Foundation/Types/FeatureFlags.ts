import type { I18nKey } from "../I18n";
import type { ReleaseChannel } from "../Release/ReleaseChannel";

export type FeatureFlagStage = "stable" | "beta" | "experimental";
export type FeatureFlagCategory = "editor" | "extensions" | "intelligence" | "performance" | "ui";

export interface FeatureFlagDefinition {
  id: string;
  stage: FeatureFlagStage;
  category: FeatureFlagCategory;
  defaultByChannel: Record<ReleaseChannel, boolean>;
  titleKey: I18nKey;
  descriptionKey: I18nKey;
  requiresReload?: boolean;
}
