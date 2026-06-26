// 可安全序列化的标签页数据类型（不含任何 React 类型）
export type TabType =
  | "file"
  | "about"
  | "settings"
  | "custom"
  | "changelog"
  | "notifications";

export type TabItem = {
  id: string;
  type: TabType;
  title: string;
  path?: string;
  isDirty?: boolean;
};
