export type TabType =
  | "file"
  | "about"
  | "settings"
  | "custom"
  | "changelog"
  | "performance"
  | "notifications"
  | "diff";

export type TabItem = {
  id: string;
  type: TabType;
  title: string;
  path?: string;
  isDirty?: boolean;
};
