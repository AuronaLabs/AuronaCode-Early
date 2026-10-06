import { BaseDirectory, desktopFileSystem } from "../Desktop";
import { AiIPC } from "../IPC/AiCommands";
import { Logger } from "../Logger";
import type { UserConfig } from "../Types/Config";

const FILE = "user-config.json";
const BASE = BaseDirectory.AppLocalData;
const { exists, mkdir, writeTextFileAtomic } = desktopFileSystem;

let memoryCache: UserConfig | null = null;
let loading: Promise<UserConfig> | null = null;
let writeChain: Promise<void> = Promise.resolve();
let firstRunDetected = false;
let credentialMigrationBlocked = false;
let generation = 0;

export const UserConfigStore = {
  async init(): Promise<void> {
    try {
      await mkdir("", { baseDir: BASE, recursive: true });
    } catch (error) {
      Logger.warn("Unable to initialize user configuration storage", error);
    }
  },

  async get(): Promise<UserConfig> {
    if (memoryCache !== null && !credentialMigrationBlocked) return memoryCache;
    if (loading) return loading;
    const currentGeneration = generation;
    const request = (async () => {
      await writeChain.catch(() => undefined);
      const assertCurrent = () => {
        if (generation !== currentGeneration) throw new Error("Configuration cache was reset");
      };
      assertCurrent();
      const fileExists = await exists(FILE, { baseDir: BASE });
      assertCurrent();
      if (!fileExists) {
        firstRunDetected = true;
        credentialMigrationBlocked = false;
        memoryCache = {};
        return memoryCache;
      }
      try {
        const config = await AiIPC.migrateUserConfig();
        assertCurrent();
        memoryCache = config;
        credentialMigrationBlocked = false;
      } catch (error) {
        if (generation === currentGeneration) credentialMigrationBlocked = true;
        Logger.error("Credential migration is paused; original configuration is preserved", error);
        throw error;
      }
      return memoryCache;
    })();
    loading = request;
    try {
      return await request;
    } finally {
      if (loading === request) loading = null;
    }
  },

  isFirstRun(): boolean {
    return firstRunDetected;
  },

  async set(config: Partial<UserConfig>): Promise<void> {
    if (
      config.ai?.apiKey ||
      config.ai?.profiles?.some((profile) => "apiKey" in profile && profile.apiKey)
    ) {
      throw new Error("Credentials must be stored through the system credential service");
    }
    const currentGeneration = generation;
    await this.get();
    if (generation !== currentGeneration) throw new Error("Configuration cache was reset");
    memoryCache = { ...memoryCache, ...config };
    const snapshot = JSON.stringify(memoryCache, null, 2);
    // Preserve order and let each caller observe the failure of its own write.
    const result = writeChain
      .catch(() => undefined)
      .then(async () => {
        if (generation !== currentGeneration) throw new Error("Configuration cache was reset");
        try {
          await writeTextFileAtomic(FILE, snapshot, { baseDir: BASE });
        } catch (error) {
          Logger.error("Unable to persist user configuration", error);
          throw error;
        }
      });
    writeChain = result;
    await result;
  },

  async flush(): Promise<void> {
    await writeChain;
  },

  resetCache(): void {
    generation++;
    memoryCache = null;
    loading = null;
    firstRunDetected = false;
    credentialMigrationBlocked = false;
  },
};
