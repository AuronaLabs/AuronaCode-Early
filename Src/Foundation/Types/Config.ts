import type { TabItem } from "./Tab";

// 工作区持久化状态（标签页、最近路径等会话级数据）
export interface WorkspaceState {
  lastOpenedPath?: string;
  openTabs?: TabItem[];
  activeTabId?: string | null;
}

// 用户偏好配置（字体、主题、密度等跨会话持久化）
export interface UserConfig {
  theme?: "light" | "dark" | "system";
  fontSize?: number;
  lineHeight?: number;
  density?: "compact" | "default" | "comfortable";
  // 终端偏好
  terminalFontSize?: number;
  terminalCursorBlink?: boolean;
}
