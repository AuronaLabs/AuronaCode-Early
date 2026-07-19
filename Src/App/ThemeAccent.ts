import type { AccentThemeId } from "../Foundation/Types/Config";

export const ACCENT_THEMES: {
  id: AccentThemeId;
  label: string;
  rgb: string;
  isDefault?: boolean;
}[] = [
  { id: "aurora", label: "极昼蓝调", rgb: "37, 99, 235", isDefault: true },
  { id: "violet", label: "绛夜星河", rgb: "124, 58, 237" },
  { id: "rose", label: "玫雾余晖", rgb: "225, 29, 72" },
  { id: "coral", label: "珊瑚落日", rgb: "234, 88, 12" },
  { id: "amber", label: "琥珀微醺", rgb: "202, 138, 4" },
  { id: "jade", label: "翡翠雨林", rgb: "5, 150, 105" },
  { id: "mint", label: "薄荷潮汐", rgb: "13, 148, 136" },
  { id: "slate", label: "石墨夜航", rgb: "71, 85, 105" },
];

export function applyAccentTheme(
  accentTheme: AccentThemeId | undefined,
  accentInBackground = false,
) {
  document.documentElement.dataset.accent = accentTheme ?? "aurora";
  document.documentElement.dataset.accentBackground = accentInBackground ? "true" : "false";
}
