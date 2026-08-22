/**
 * Aurona Code 设置分类与基础类型规范
 * 位于 Foundation 层，供 EventBus、SettingRegistry 及各业务模块单向引用
 */

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

export type SettingType = "boolean" | "number" | "string" | "select";
