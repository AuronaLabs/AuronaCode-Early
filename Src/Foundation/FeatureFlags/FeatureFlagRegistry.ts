import type { FeatureFlagDefinition } from "../Types/FeatureFlags";

/**
 * 官方声明式 Feature Flags 注册表
 * 声明已合并至主干的特性及当前构建统一使用的默认状态。
 */
export const OFFICIAL_FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    id: "editor.minimap",
    stage: "stable",
    category: "editor",
    defaultEnabled: true,
    titleKey: "settings.featureFlags.editorMinimap.title",
    descriptionKey: "settings.featureFlags.editorMinimap.desc",
  },
  {
    id: "editor.bracketPairColorization",
    stage: "stable",
    category: "editor",
    defaultEnabled: true,
    titleKey: "settings.featureFlags.editorBracketPair.title",
    descriptionKey: "settings.featureFlags.editorBracketPair.desc",
  },
  {
    id: "editor.codeFolding",
    stage: "stable",
    category: "editor",
    defaultEnabled: true,
    titleKey: "settings.featureFlags.editorCodeFolding.title",
    descriptionKey: "settings.featureFlags.editorCodeFolding.desc",
  },
  {
    id: "editor.trueFolding",
    stage: "beta",
    category: "editor",
    defaultEnabled: true,
    titleKey: "settings.featureFlags.editorTrueFolding.title",
    descriptionKey: "settings.featureFlags.editorTrueFolding.desc",
  },
  {
    id: "editor.smoothCaret",
    stage: "beta",
    category: "editor",
    defaultEnabled: true,
    titleKey: "settings.featureFlags.editorSmoothCaret.title",
    descriptionKey: "settings.featureFlags.editorSmoothCaret.desc",
  },
  {
    id: "editor.selectionOccurrence",
    stage: "stable",
    category: "editor",
    defaultEnabled: true,
    titleKey: "settings.featureFlags.editorOccurrence.title",
    descriptionKey: "settings.featureFlags.editorOccurrence.desc",
  },
  {
    id: "performance.asciiFastMetrics",
    stage: "stable",
    category: "performance",
    defaultEnabled: true,
    titleKey: "settings.featureFlags.asciiFastMetrics.title",
    descriptionKey: "settings.featureFlags.asciiFastMetrics.desc",
  },
  {
    id: "extensions.vscodeCompatTranspiler",
    stage: "beta",
    category: "extensions",
    defaultEnabled: true,
    titleKey: "settings.featureFlags.vscodeCompat.title",
    descriptionKey: "settings.featureFlags.vscodeCompat.desc",
  },
];

export const FEATURE_FLAG_MAP: ReadonlyMap<string, FeatureFlagDefinition> = new Map(
  OFFICIAL_FEATURE_FLAGS.map((flag) => [flag.id, flag]),
);
