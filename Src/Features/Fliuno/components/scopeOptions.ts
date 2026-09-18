import type { FliunoScope } from "../../../Core/Fliuno/FliunoCore";
import type { I18nKey } from "../../../Foundation/I18n";

export interface FliunoScopeOption {
  id: FliunoScope;
  labelKey: I18nKey;
}

/** Modal 与工作区页共用：chips 渲染顺序 = Tab 键盘循环顺序。 */
export const FLIUNO_SCOPE_OPTIONS: FliunoScopeOption[] = [
  { id: "all", labelKey: "fliuno.scopeAll" },
  { id: "commands", labelKey: "common.command" },
  { id: "files", labelKey: "common.file" },
  { id: "settings", labelKey: "common.setting" },
  { id: "symbols", labelKey: "common.symbol" },
  { id: "extensions", labelKey: "extensions.sidebarTitle" },
  { id: "content", labelKey: "common.content" },
];
