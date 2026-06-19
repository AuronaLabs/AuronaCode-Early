import { ReactNode } from "react";

export type TabType = "file" | "about" | "settings" | "custom" | "changelog" | "notifications";

export type TabItem = {
  id: string;        // Unique identifier (e.g., file path or "about-page")
  type: TabType;     // Type of the tab
  title: string;     // Display title
  path?: string;     // Associated file path if type is "file"
  icon?: ReactNode;  // Optional custom icon
  isDirty?: boolean; // Whether it has unsaved changes
};
