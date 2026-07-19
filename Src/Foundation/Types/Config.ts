import type { TabItem } from "./Tab";

export type AccentThemeId =
  | "aurora"
  | "violet"
  | "rose"
  | "coral"
  | "amber"
  | "jade"
  | "mint"
  | "slate";

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
  accentTheme?: AccentThemeId;
  accentInBackground?: boolean;
  fontSize?: number;
  lineHeight?: number;
  density?: "compact" | "default" | "comfortable";

  editorFontSize?: number;
  editorLineHeight?: number;
  editorTabSize?: number;
  editorWordWrap?: "on" | "off" | "wordWrapColumn" | "bounded";
  editorMinimap?: boolean;

  terminalFontSize?: number;
  terminalCursorBlink?: boolean;
}
