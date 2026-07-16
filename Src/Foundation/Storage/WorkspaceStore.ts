import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { WorkspaceState } from "../Types/Config";
import { Logger } from "../Logger";

const FILE = "workspace.json";
const BASE = BaseDirectory.AppLocalData;

let memoryCache: WorkspaceState | null = null;
let isWriting = false;
let pendingWrite = false;

export const WorkspaceStore = {
  _debounceTimer: null as ReturnType<typeof setTimeout> | null,

  async init(): Promise<void> {
    try {
      await mkdir("", { baseDir: BASE, recursive: true });
    } catch (error) {
      Logger.warn("Unable to initialize workspace storage", error);
    }
  },

  async get(): Promise<WorkspaceState> {
    try {
      if (memoryCache !== null) return memoryCache;

      const fileExists = await exists(FILE, { baseDir: BASE });
      if (!fileExists) {
        memoryCache = {};
        return memoryCache;
      }
      const content = await readTextFile(FILE, { baseDir: BASE });
      memoryCache = JSON.parse(content) as WorkspaceState;
      return memoryCache;
    } catch (error) {
      Logger.error("Unable to read workspace state; using in-memory defaults", error);
      return {};
    }
  },

  getCached(): WorkspaceState | null {
    return memoryCache;
  },

  async set(state: Partial<WorkspaceState>): Promise<void> {
    const current = await this.get();
    memoryCache = { ...current, ...state };

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(() => {
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
          Logger.error("Unable to persist workspace state", error);
        }
        isWriting = false;
        if (pendingWrite) {
          flush();
        }
      };

      flush();
    }, 500);
  },

  resetCache(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = null;
    memoryCache = null;
    isWriting = false;
    pendingWrite = false;
  },
};
