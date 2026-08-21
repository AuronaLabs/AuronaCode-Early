import type { I18nKey } from "../../Foundation/I18n";

export type SettingCategory =
  | "general"
  | "appearance"
  | "editor"
  | "codeIntelligence"
  | "terminalRun"
  | "sourceControl"
  | "accountCloud"
  | "extensions"
  | "system"
  | "advanced";

/**
 * Registry 的职责边界：
 * - 只登记「可搜索的偏好项」（Preference）：有默认值、可被设置 UI 修改。
 * - 按钮动作（检查更新/初始化重置/清理）、导航目标（Git Remote 页、性能测试）不属于 Preference，
 *   不登记为 Setting，避免产生假的 source of truth。
 * 设置 UI 与 Fliuno Settings Provider 都以本注册表为搜索数据源。
 */
export type SettingType = "boolean" | "number" | "string" | "select";

export interface SettingDefinition {
  id: string;
  category: SettingCategory;
  titleKey: I18nKey;
  descriptionKey?: I18nKey;
  /** 搜索关键词：中英文同义词，供 Fliuno Settings Provider 与设置搜索使用。 */
  keywords: string[];
  type: SettingType;
  defaultValue: unknown;
  experimental?: boolean;
}

export const SETTING_CATEGORY_KEYS: Record<SettingCategory, I18nKey> = {
  general: "settings.categories.general",
  appearance: "settings.categories.appearance",
  editor: "settings.categories.editor",
  codeIntelligence: "settings.categories.codeIntelligence",
  terminalRun: "settings.categories.terminalRun",
  sourceControl: "settings.categories.sourceControl",
  accountCloud: "settings.categories.accountCloud",
  extensions: "settings.categories.extensions",
  system: "settings.categories.system",
  advanced: "settings.categories.advanced",
};

const settings = new Map<string, SettingDefinition>();

export function registerSetting(definition: SettingDefinition): void {
  settings.set(definition.id, definition);
}

export function getSetting(id: string): SettingDefinition | undefined {
  return settings.get(id);
}

export function getSettingsByCategory(category: SettingCategory): SettingDefinition[] {
  return [...settings.values()]
    .filter((setting) => setting.category === category)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getAllSettings(): SettingDefinition[] {
  return [...settings.values()];
}

export function getSettingCategories(): SettingCategory[] {
  return Object.keys(SETTING_CATEGORY_KEYS) as SettingCategory[];
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("zh-CN");
}

function tokenMatch(token: string, haystack: string): boolean {
  return normalize(haystack).includes(normalize(token));
}

/** 设置搜索：关键词/ID/标题/描述做分词 AND 匹配，作为 Fliuno Settings Provider 的基础。 */
export function searchSettings(
  query: string,
  localeTitle: (key: I18nKey) => string,
): SettingDefinition[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return getAllSettings().filter((setting) => {
    const title = localeTitle(setting.titleKey);
    const description = setting.descriptionKey ? localeTitle(setting.descriptionKey) : "";
    const haystacks = [setting.id, title, description, ...setting.keywords];
    return tokens.every((token) => haystacks.some((value) => tokenMatch(token, value)));
  });
}

registerSetting({
  id: "theme",
  category: "general",
  titleKey: "settings.definitions.theme.title",
  descriptionKey: "settings.definitions.theme.description",
  keywords: ["theme", "dark", "light", "外观模式", "深色", "浅色"],
  type: "select",
  defaultValue: "system",
});

registerSetting({
  id: "density",
  category: "general",
  titleKey: "settings.definitions.density.title",
  descriptionKey: "settings.definitions.density.description",
  keywords: ["density", "compact", "regular", "comfortable", "界面密度", "紧凑", "常规", "宽松"],
  type: "select",
  defaultValue: "default",
});

registerSetting({
  id: "language",
  category: "general",
  titleKey: "settings.definitions.language.title",
  descriptionKey: "settings.definitions.language.description",
  keywords: ["language", "locale", "i18n", "语言", "界面语言"],
  type: "select",
  defaultValue: "zh-CN",
});

registerSetting({
  id: "accentTheme",
  category: "appearance",
  titleKey: "settings.definitions.accentTheme.title",
  descriptionKey: "settings.definitions.accentTheme.description",
  keywords: ["accent", "theme", "color", "主题", "颜色", "强调色"],
  type: "select",
  defaultValue: "aurora",
});

registerSetting({
  id: "liquidTexture",
  category: "appearance",
  titleKey: "settings.definitions.liquidTexture.title",
  descriptionKey: "settings.definitions.liquidTexture.description",
  keywords: ["flowing", "light", "liquid", "流光", "液态", "光带"],
  type: "boolean",
  defaultValue: false,
});

registerSetting({
  id: "materialIntensity",
  category: "appearance",
  titleKey: "settings.definitions.materialIntensity.title",
  descriptionKey: "settings.definitions.materialIntensity.description",
  keywords: ["material", "glass", "intensity", "拟物", "毛玻璃", "强度"],
  type: "select",
  defaultValue: "medium",
});

registerSetting({
  id: "boldText",
  category: "appearance",
  titleKey: "settings.definitions.boldText.title",
  descriptionKey: "settings.definitions.boldText.description",
  keywords: ["bold", "weight", "font", "粗体", "字重", "字体"],
  type: "boolean",
  defaultValue: false,
});

registerSetting({
  id: "interfaceFontSize",
  category: "appearance",
  titleKey: "settings.definitions.interfaceFontSize.title",
  descriptionKey: "settings.definitions.interfaceFontSize.description",
  keywords: ["font", "size", "interface", "scale", "字号", "文字大小", "界面"],
  type: "select",
  defaultValue: "default",
});

registerSetting({
  id: "hoverEnabled",
  category: "codeIntelligence",
  titleKey: "settings.definitions.hoverEnabled.title",
  descriptionKey: "settings.definitions.hoverEnabled.description",
  keywords: ["hover", "悬浮", "lsp", "提示"],
  type: "boolean",
  defaultValue: true,
});

registerSetting({
  id: "hoverDelayMs",
  category: "codeIntelligence",
  titleKey: "settings.definitions.hoverDelayMs.title",
  descriptionKey: "settings.definitions.hoverDelayMs.description",
  keywords: ["hover", "delay", "悬浮", "延迟"],
  type: "number",
  defaultValue: 600,
});

registerSetting({
  id: "automaticCompletion",
  category: "codeIntelligence",
  titleKey: "settings.definitions.automaticCompletion.title",
  descriptionKey: "settings.definitions.automaticCompletion.description",
  keywords: ["completion", "autocomplete", "补全", "自动补全"],
  type: "boolean",
  defaultValue: true,
});

registerSetting({
  id: "editorFontSize",
  category: "editor",
  titleKey: "settings.definitions.editorFontSize.title",
  descriptionKey: "settings.definitions.editorFontSize.description",
  keywords: ["editor", "font", "字体", "字号"],
  type: "number",
  defaultValue: 14,
});

registerSetting({
  id: "editorLineHeight",
  category: "editor",
  titleKey: "settings.definitions.editorLineHeight.title",
  descriptionKey: "settings.definitions.editorLineHeight.description",
  keywords: ["line", "height", "行高"],
  type: "number",
  defaultValue: 24,
});

registerSetting({
  id: "editorTabSize",
  category: "editor",
  titleKey: "settings.definitions.editorTabSize.title",
  descriptionKey: "settings.definitions.editorTabSize.description",
  keywords: ["tab", "indent", "缩进", "制表符"],
  type: "number",
  defaultValue: 2,
});

registerSetting({
  id: "editorWordWrap",
  category: "editor",
  titleKey: "settings.definitions.editorWordWrap.title",
  descriptionKey: "settings.definitions.editorWordWrap.description",
  keywords: ["word", "wrap", "换行"],
  type: "select",
  defaultValue: "on",
});

registerSetting({
  id: "editorMinimap",
  category: "editor",
  titleKey: "settings.definitions.editorMinimap.title",
  descriptionKey: "settings.definitions.editorMinimap.description",
  keywords: ["minimap", "thumbnail", "缩略图"],
  type: "boolean",
  defaultValue: false,
  experimental: true,
});

registerSetting({
  id: "terminalFontSize",
  category: "terminalRun",
  titleKey: "settings.definitions.terminalFontSize.title",
  descriptionKey: "settings.definitions.terminalFontSize.description",
  keywords: ["terminal", "font", "终端", "字体"],
  type: "number",
  defaultValue: 13,
});

registerSetting({
  id: "terminalCursorBlink",
  category: "terminalRun",
  titleKey: "settings.definitions.terminalCursorBlink.title",
  descriptionKey: "settings.definitions.terminalCursorBlink.description",
  keywords: ["terminal", "cursor", "blink", "终端", "光标", "闪烁"],
  type: "boolean",
  defaultValue: true,
});

registerSetting({
  id: "openSidebarOnStart",
  category: "terminalRun",
  titleKey: "settings.definitions.openSidebarOnStart.title",
  descriptionKey: "settings.definitions.openSidebarOnStart.description",
  keywords: ["debug", "sidebar", "调试", "侧栏"],
  type: "boolean",
  defaultValue: true,
});

registerSetting({
  id: "consoleMode",
  category: "terminalRun",
  titleKey: "settings.definitions.consoleMode.title",
  descriptionKey: "settings.definitions.consoleMode.description",
  keywords: ["debug", "console", "调试", "控制台"],
  type: "select",
  defaultValue: "integrated",
});

registerSetting({
  id: "adapterLogLevel",
  category: "terminalRun",
  titleKey: "settings.definitions.adapterLogLevel.title",
  descriptionKey: "settings.definitions.adapterLogLevel.description",
  keywords: ["adapter", "debug", "log", "日志", "调试"],
  type: "select",
  defaultValue: "info",
});

registerSetting({
  id: "pythonPath",
  category: "terminalRun",
  titleKey: "settings.definitions.pythonPath.title",
  descriptionKey: "settings.definitions.pythonPath.description",
  keywords: ["python", "debug", "解释器", "调试"],
  type: "string",
  defaultValue: "python",
});

registerSetting({
  id: "nodePath",
  category: "terminalRun",
  titleKey: "settings.definitions.nodePath.title",
  descriptionKey: "settings.definitions.nodePath.description",
  keywords: ["node", "debug", "调试"],
  type: "string",
  defaultValue: "node",
});

registerSetting({
  id: "stopOnEntry",
  category: "terminalRun",
  titleKey: "settings.definitions.stopOnEntry.title",
  descriptionKey: "settings.definitions.stopOnEntry.description",
  keywords: ["debug", "stop", "entry", "调试", "暂停", "入口"],
  type: "boolean",
  defaultValue: false,
});

registerSetting({
  id: "logLevel",
  category: "advanced",
  titleKey: "settings.definitions.logLevel.title",
  descriptionKey: "settings.definitions.logLevel.description",
  keywords: ["log", "debug", "日志", "调试日志"],
  type: "select",
  defaultValue: "info",
  experimental: true,
});
