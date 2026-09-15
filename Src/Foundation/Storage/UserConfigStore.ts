import { BaseDirectory, desktopFileSystem } from "../Desktop";
import { Logger } from "../Logger";
import type { UserConfig } from "../Types/Config";

const FILE = "user-config.json";
const BASE = BaseDirectory.AppLocalData;
const { exists, mkdir, readTextFile, writeTextFile } = desktopFileSystem;

let isWriting = false;
let pendingWrite = false;
let memoryCache: UserConfig | null = null;
/** 首次加载时即无 user-config.json：用于首启 OOBE 判定，免去重复 exists IPC */
let firstRunDetected = false;

export const UserConfigStore = {
  async init(): Promise<void> {
    try {
      await mkdir("", { baseDir: BASE, recursive: true });
    } catch (error) {
      Logger.warn("Unable to initialize user configuration storage", error);
    }
  },

  async get(): Promise<UserConfig> {
    try {
      if (memoryCache !== null) return memoryCache;

      const fileExists = await exists(FILE, { baseDir: BASE });
      if (!fileExists) {
        firstRunDetected = true;
        memoryCache = {};
        return memoryCache;
      }
      const content = await readTextFile(FILE, { baseDir: BASE });
      memoryCache = JSON.parse(content) as UserConfig;
      return memoryCache;
    } catch (error) {
      Logger.error("Unable to read user configuration; using in-memory defaults", error);
      return {};
    }
  },

  /** 首次 get() 时是否即无配置文件（首启判定） */
  isFirstRun(): boolean {
    return firstRunDetected;
  },

  async set(config: Partial<UserConfig>): Promise<void> {
    // 同步合并到内存缓存（避免 await 间隙丢失并发 set 的字段），写盘走 flush 队列
    memoryCache = { ...(memoryCache ?? (await this.get())), ...config };

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
      } catch (error) {
        Logger.error("Unable to persist user configuration", error);
      }
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
    firstRunDetected = false;
  },
};
