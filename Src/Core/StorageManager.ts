import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const CONFIG_FILE = "workspace.json";

export interface WorkspaceConfig {
  lastOpenedPath?: string;
}

export const StorageManager = {
  async init(): Promise<void> {
    try {
      try {
        await mkdir("", { baseDir: BaseDirectory.AppLocalData, recursive: true });
      } catch {
        // The root may already exist, or the platform may not support mkdir on the base directory itself.
      }

      const configExists = await exists(CONFIG_FILE, { baseDir: BaseDirectory.AppLocalData });
      if (!configExists) {
        await writeTextFile(CONFIG_FILE, JSON.stringify({}), { baseDir: BaseDirectory.AppLocalData });
      }
    } catch (error) {
      console.error("StorageManager init error:", error);
      throw new Error(`无法初始化本地工作区配置：${error}`);
    }
  },

  async getConfig(): Promise<WorkspaceConfig> {
    try {
      const configExists = await exists(CONFIG_FILE, { baseDir: BaseDirectory.AppLocalData });
      if (!configExists) return {};

      const content = await readTextFile(CONFIG_FILE, { baseDir: BaseDirectory.AppLocalData });
      return JSON.parse(content);
    } catch (error) {
      console.error("Failed to read config:", error);
      return {};
    }
  },

  async saveConfig(config: WorkspaceConfig) {
    try {
      const current = await this.getConfig();
      const nextConfig = { ...current, ...config };
      await writeTextFile(CONFIG_FILE, JSON.stringify(nextConfig, null, 2), { baseDir: BaseDirectory.AppLocalData });
    } catch (error) {
      console.error("Failed to save config:", error);
    }
  },
};
