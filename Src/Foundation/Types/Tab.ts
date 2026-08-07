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
  path?: string;
  isDirty?: boolean;
};
