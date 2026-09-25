import type { TabItem } from "./Tab";

export interface LanguageServerConfiguration {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  initializationOptions?: unknown;
  settings?: unknown;
  requestTimeout?: number;
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

/** 外观段偏好：新外观设置的持久化入口 */
export interface AppearancePreferences {
  /** Aurona 玻璃强度连续值 0-100（0 轻透 / 50 均衡 / 100 醇厚锚点，松手提交时写入） */
  glassIntensity?: number;
}

/** 单条 AI 模型配置档（0.4.9 多模型；密钥仅存本地 UserConfig，零遥测） */
export interface AiProfile {
  /** 稳定 id（前端生成，uuid） */
  id: string;
  /** 显示名称（空串时 UI 回退显示模型名或占位） */
  name: string;
  /** 服务商预设：custom 时 baseUrl 手工填写 */
  provider?: "openai" | "deepseek" | "openrouter" | "custom";
  /** OpenAI 兼容 Chat Completions 接口地址 */
  baseUrl: string;
  /** API Key（仅本机存储） */
  apiKey: string;
  /** 模型名称 */
  model: string;
}

/** 0.4.6 批次 5：AI 助手偏好（纯聊天；API Key 仅存本地 UserConfig，零遥测） */
export interface AiPreferences {
  /** 是否在侧边栏启用 AI 助手卡片 */
  enabled?: boolean;
  /** 是否启用 agent 工具执行（读/搜/改文件、运行命令；写类操作始终需用户确认） */
  agentEnabled?: boolean;
  /** Agent 工具权限：询问、只读、可编辑或完整访问。 */
  agentPermission?: "ask" | "read" | "edit" | "full";
  /** 服务商预设：custom 时 baseUrl 手工填写 */
  provider?: "openai" | "deepseek" | "openrouter" | "custom";
  /** OpenAI 兼容 Chat Completions 接口地址（deprecated：0.4.9 起由 profiles 承载，仅作迁移源） */
  baseUrl?: string;
  /** API Key（仅本机存储）（deprecated：0.4.9 起由 profiles 承载，仅作迁移源） */
  apiKey?: string;
  /** 模型名称（deprecated：0.4.9 起由 profiles 承载，仅作迁移源） */
  model?: string;
  /** 模型配置档列表（真源；旧单配置四字段仅作迁移源） */
  profiles?: AiProfile[];
  /** 当前激活配置档 id（缺失或无效时回退 profiles[0]） */
  activeProfileId?: string;
}

export interface UserConfig {
  theme?: "light" | "dark" | "system";
  /** 界面语言（真源为 UserConfig；localStorage 仅为启动同步快照） */
  locale?: "zh-CN" | "zh-Hant" | "en" | "de" | "it" | "ja";
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
  editorCapsuleEnabled?: boolean;
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
  marketplaceServerUrl?: string;
  /** Keep the built-in VSCode compatibility runtime available for VSIX extensions. */
  vscodeCompatEnabled?: boolean;
  muteNonCriticalToasts?: boolean;
  toastDuration?: number;
  fliuno?: FliunoPreferences;
  cleanup?: CleanupPreferences;
  windowState?: WindowStatePreferences;
  network?: NetworkPreferences;
  appearance?: AppearancePreferences;
  ai?: AiPreferences;
  /** 隐藏的扩展 id 列表（真源为 UserConfig；localStorage 仅为启动同步快照） */
  hiddenExtensionIds?: string[];
}
