import {
  FLIUNO_RECENT_COMMANDS_KEY,
  FLIUNO_RECENT_FILES_KEY,
  LEGACY_RECENT_KEY,
} from "../../Core/Fliuno/history";

/**
 * localStorage key 所有权清单。
 * - appGlobal：应用全局数据，只能由明确的 Factory Reset 清理。
 * - workspace：工作区状态，清理 Workspace State 时只允许删除这里的 key。
 */
export const STORAGE_OWNERSHIP = {
  appGlobal: [
    "aurona.locale",
    FLIUNO_RECENT_COMMANDS_KEY,
    FLIUNO_RECENT_FILES_KEY,
    LEGACY_RECENT_KEY,
  ],
  workspace: [],
} as const;

export function clearWorkspaceLocalState(): void {
  for (const key of STORAGE_OWNERSHIP.workspace) {
    localStorage.removeItem(key);
  }
}
