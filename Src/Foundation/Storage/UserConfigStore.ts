import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { UserConfig } from "../Types/Config";

const FILE = "user-config.json";
const BASE = BaseDirectory.AppLocalData;

let isWriting = false;
let pendingWrite = false;
let memoryCache: UserConfig | null = null;

export const UserConfigStore = {
  async init(): Promise<void> {
    try {
      await mkdir("", { baseDir: BASE, recursive: true });
    } catch {}
  },

  async get(): Promise<UserConfig> {
    try {
      if (memoryCache !== null) return memoryCache;

      const fileExists = await exists(FILE, { baseDir: BASE });
      if (!fileExists) {
        memoryCache = {};
        return memoryCache;
      }
      const content = await readTextFile(FILE, { baseDir: BASE });
      memoryCache = JSON.parse(content) as UserConfig;
      return memoryCache;
    } catch {
      return {};
    }
  },

  async set(config: Partial<UserConfig>): Promise<void> {
    const current = await this.get();
    const next = { ...current, ...config };
    memoryCache = next;

    if (isWriting) {
      pendingWrite = true;
      return;
    }

    const flush = async () => {
      isWriting = true;
      pendingWrite = false;
      try {
        await writeTextFile(FILE, JSON.stringify(memoryCache, null, 2), {
          baseDir: BASE,
        });
      } catch {}
      isWriting = false;
      if (pendingWrite) {
        flush();
      }
    };

    flush();
  },

  resetCache(): void {
    memoryCache = null;
    isWriting = false;
    pendingWrite = false;
  },
};
