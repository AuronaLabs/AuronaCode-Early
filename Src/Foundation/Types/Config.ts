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

/** 主窗口布局记忆：物理像素坐标，恢复时做屏幕边界钳制 */
export interface WindowStatePreferences {
  isMaximized?: boolean;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}

/** 网络代理偏好：仅作用于更新检查与工具链下载（Marketplace 扩展下载走前端 fetch 不在内） */
export interface NetworkPreferences {
  proxyMode?: "system" | "custom" | "none";
  proxyUrl?: string;
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
  /** 光标大幅跳转时的 120ms 缓动滚动开关 */
  editorSmoothScrolling?: boolean;
  /** Fliuno 内容搜索默认大小写敏感 */
  fliunoSearchCaseSensitive?: boolean;
  /** Fliuno 内容搜索默认正则模式 */
  fliunoSearchRegex?: boolean;

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
  windowState?: WindowStatePreferences;
  network?: NetworkPreferences;
}
