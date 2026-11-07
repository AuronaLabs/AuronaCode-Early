import { BaseDirectory, desktopFileSystem } from "../Desktop/FileSystem";
import { Logger } from "../Logger";
import type { WorkspaceState } from "../Types/Config";
import { PendingWrites } from "./PendingWrites";

const FILE = "workspace.json";
const BASE = BaseDirectory.AppLocalData;
const { exists, mkdir, readTextFile, writeTextFileAtomic } = desktopFileSystem;

let memoryCache: WorkspaceState | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let writeChain = Promise.resolve();
let loading: Promise<WorkspaceState> | null = null;
let generation = 0;
let revision = 0;
let dirty = false;
const pendingWrites = new PendingWrites();

async function persistSnapshot(snapshot: WorkspaceState): Promise<void> {
  await writeTextFileAtomic(FILE, JSON.stringify(snapshot, null, 2), { baseDir: BASE });
}

function queuePersist(): void {
  if (!memoryCache || !dirty) return;
  const snapshot = structuredClone(memoryCache);
  const currentGeneration = generation;
  const currentRevision = revision;
  writeChain = writeChain
    .catch(() => undefined)
    .then(async () => {
      if (generation !== currentGeneration) return;
      await persistSnapshot(snapshot);
      if (generation === currentGeneration && revision === currentRevision) dirty = false;
    });
  // Observe background failures without hiding them from flush and safe-close callers.
  void writeChain.catch((error) => Logger.error("Unable to persist workspace state", error));
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
    if (memoryCache !== null) return memoryCache;
    if (loading) return loading;
    const currentGeneration = generation;
    const request = (async () => {
      await writeChain.catch(() => undefined);
      const assertCurrent = () => {
        if (generation !== currentGeneration) throw new Error("Workspace cache was reset");
      };
      assertCurrent();
      try {
        const fileExists = await exists(FILE, { baseDir: BASE });
        assertCurrent();
        if (!fileExists) {
          memoryCache = {};
          return memoryCache;
        }
        const value: unknown = JSON.parse(await readTextFile(FILE, { baseDir: BASE }));
        assertCurrent();
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Workspace state must be an object");
        memoryCache = value as WorkspaceState;
        return memoryCache;
      } catch (error) {
        assertCurrent();
        Logger.error("Unable to read workspace state; using in-memory defaults", error);
        memoryCache = {};
        return memoryCache;
      }
    })();
    loading = request;
    try {
      return await request;
    } finally {
      if (loading === request) loading = null;
    }
  },

  getCached(): WorkspaceState | null {
    return memoryCache;
  },

  set(state: Partial<WorkspaceState>): Promise<void> {
    return pendingWrites.track(
      (async () => {
        const currentGeneration = generation;
        await this.get();
        if (generation !== currentGeneration) throw new Error("Workspace cache was reset");
        memoryCache = { ...memoryCache, ...state };
        revision++;
        dirty = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          queuePersist();
        }, 500);
      })(),
    );
  },

  async flush(): Promise<void> {
    await pendingWrites.flush();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    queuePersist();
    await writeChain;
  },

  resetCache(): void {
    generation++;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    memoryCache = null;
    loading = null;
    dirty = false;
    revision = 0;
  },
};
