
export type TabType = "file" | "about" | "settings" | "custom" | "changelog" | "notifications";

export type TabItem = {
  id: string;
  type: TabType;
  title: string;
  path?: string;
  isDirty?: boolean;
};
