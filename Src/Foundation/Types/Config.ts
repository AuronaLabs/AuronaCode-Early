import type { TabItem } from "./Tab";

export interface LanguageServerConfiguration {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  initializationOptions?: unknown;
  settings?: unknown;
  startupTimeout?: number;
  requestTimeout?: number;
  restartLimit?: number;
}

export interface LanguageFeaturePreferences {
  hoverEnabled?: boolean;
  hoverDelayMs?: number;
  automaticCompletion?: boolean;
}

export interface DebugPreferences {
  openSidebarOnStart?: boolean;
  consoleMode?: "integrated" | "terminal" | "none";
  stopOnEntry?: boolean;
  adapterLogLevel?: "error" | "warn" | "info" | "debug";
  pythonPath?: string;
  nodePath?: string;
}

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
  sidebarWidth?: number;
  isBottomPanelOpen?: boolean;
  activeBottomPanel?: "problems" | "output" | "terminal" | "debug-console" | "references";
  bottomPanelHeight?: number;
}

export interface FliunoPreferences {
  /** Fliuno workspace 打开位置：左侧侧边栏（默认）或编辑区标签页 */
  openMode?: "sidebar" | "editorTab";
}

export interface CleanupPreferences {
  /** 退出应用时自动清理 WebView/缓存目录（默认开启） */
  clearCacheOnExit?: boolean;
}

export interface UserConfig {
  theme?: "light" | "dark" | "system";
  accentTheme?: AccentThemeId;
  accentInBackground?: boolean;
  liquidTexture?: boolean;
  fontSize?: number;
  lineHeight?: number;
  density?: "compact" | "default" | "regular" | "comfortable";
  boldText?: boolean;
  interfaceFontSize?: "compact" | "default" | "comfortable" | "large";

  editorFontSize?: number;
  editorLineHeight?: number;
  editorTabSize?: number;
  editorWordWrap?: "on" | "off" | "wordWrapColumn" | "bounded";
  editorMinimap?: boolean;
  editorCursorSmoothCaret?: boolean;

  terminalFontSize?: number;
  terminalCursorBlink?: boolean;
  trustedWorkspaceRoots?: string[];
  languageServers?: Record<string, LanguageServerConfiguration>;
  languageFeatures?: LanguageFeaturePreferences;
  debug?: DebugPreferences;
  releaseChannel?: "stable" | "pioneer";
  featureFlags?: Record<string, boolean>;
  marketplaceServerUrl?: string;
  /** Keep the built-in VSCode compatibility runtime available for VSIX extensions. */
  vscodeCompatEnabled?: boolean;
  muteNonCriticalToasts?: boolean;
  toastDuration?: number;
  fliuno?: FliunoPreferences;
  cleanup?: CleanupPreferences;
}
