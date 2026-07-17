import { BaseDirectory, desktopFileSystem } from "../Desktop";
import { Logger } from "../Logger";
import type { WorkspaceState } from "../Types/Config";

const FILE = "workspace.json";
const BASE = BaseDirectory.AppLocalData;
const { exists, mkdir, readTextFile, writeTextFile } = desktopFileSystem;

let memoryCache: WorkspaceState | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let writeChain = Promise.resolve();

async function persistSnapshot(snapshot: WorkspaceState): Promise<void> {
  await writeTextFile(FILE, JSON.stringify(snapshot, null, 2), { baseDir: BASE });
}

function queuePersist(): void {
  if (!memoryCache) return;
  const snapshot = structuredClone(memoryCache);
  writeChain = writeChain
    .catch(() => undefined)
    .then(() => persistSnapshot(snapshot))
    .catch((error) => Logger.error("Unable to persist workspace state", error));
}

export const WorkspaceStore = {
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
      if (!(await exists(FILE, { baseDir: BASE }))) {
        memoryCache = {};
        return memoryCache;
      }
      memoryCache = JSON.parse(await readTextFile(FILE, { baseDir: BASE })) as WorkspaceState;
      return memoryCache;
    } catch (error) {
      Logger.error("Unable to read workspace state; using in-memory defaults", error);
      memoryCache = {};
      return memoryCache;
    }
  },

  getCached(): WorkspaceState | null {
    return memoryCache;
  },

  async set(state: Partial<WorkspaceState>): Promise<void> {
    memoryCache = { ...(await this.get()), ...state };
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      queuePersist();
    }, 500);
  },

  async flush(): Promise<void> {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      queuePersist();
    }
    await writeChain;
  },

  resetCache(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    memoryCache = null;
    writeChain = Promise.resolve();
  },
};
