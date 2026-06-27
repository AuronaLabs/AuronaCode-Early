import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { UserConfig } from "../Types/Config";

const FILE = "user-config.json";
const BASE = BaseDirectory.AppLocalData;

let writeQueue: Promise<void> = Promise.resolve();
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

  set(config: Partial<UserConfig>): void {
    writeQueue = writeQueue
      .then(async () => {
        try {
          const current = await this.get();
          const next = { ...current, ...config };
          memoryCache = next; // Update memory cache synchronously
          await writeTextFile(FILE, JSON.stringify(next, null, 2), {
            baseDir: BASE,
          });
        } catch {}
      })
      .catch(() => {});
  },
};
