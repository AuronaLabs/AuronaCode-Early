export const FLIUNO_RECENT_COMMANDS_KEY = "aurona.fliuno.recent.v1";
export const FLIUNO_RECENT_FILES_KEY = "aurona.fliuno.files.recent.v1";
export const LEGACY_RECENT_KEY = "aurona.commandPalette.recent.v1";

export const readHistory = (key: string, fallbackKey?: string): string[] => {
  try {
    const value = localStorage.getItem(key) ?? (fallbackKey && localStorage.getItem(fallbackKey));
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

export const writeHistory = (key: string, value: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(value.slice(0, 30)));
  } catch {
    // 搜索历史可选，不阻塞操作。
  }
};
