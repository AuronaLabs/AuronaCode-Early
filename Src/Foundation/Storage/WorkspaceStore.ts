import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { WorkspaceState } from "../Types/Config";

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
    } catch {}
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
    } catch {
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
        } catch {}
        isWriting = false;
        if (pendingWrite) {
          flush();
        }
      };

      flush();
    }, 500);
  },
};
