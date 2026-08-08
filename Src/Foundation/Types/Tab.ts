import type { I18nKey } from "../I18n";

export type TabType =
  | "file"
  | "about"
  | "settings"
  | "custom"
  | "changelog"
  | "performance"
  | "notifications"
  | "diff"
  | "fliuno";

export type TabItem = {
  id: string;
  type: TabType;
  title: string;
  titleKey?: I18nKey;
  path?: string;
  isDirty?: boolean;
};
