import type { TabItem } from "./Tab";

export interface WorkspaceState {
  lastOpenedPath?: string;
  openTabs?: TabItem[];
  activeTabId?: string | null;
  activeSidebar?: string | null;
  isBottomPanelOpen?: boolean;
  activeBottomPanel?: "problems" | "output" | "terminal";
}

export interface UserConfig {
  theme?: "light" | "dark" | "system";
  fontSize?: number;
  lineHeight?: number;
  density?: "compact" | "default" | "comfortable";

  editorFontSize?: number;
  editorWordWrap?: "on" | "off" | "wordWrapColumn" | "bounded";
  editorMinimap?: boolean;

  terminalFontSize?: number;
  terminalCursorBlink?: boolean;
}
