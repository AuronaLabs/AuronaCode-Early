import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { WorkspaceState } from "../Types/Config";

const FILE = "workspace.json";
const BASE = BaseDirectory.AppLocalData;



export const WorkspaceStore = {
  _writeQueue: Promise.resolve() as Promise<void>,
  _debounceTimer: null as ReturnType<typeof setTimeout> | null,
  _pendingState: {} as Partial<WorkspaceState>,
  async init(): Promise<void> {
    try {
      await mkdir("", { baseDir: BASE, recursive: true });
    } catch {
      // 目录可能已存在
    }
  },

  async get(): Promise<WorkspaceState> {
    try {
      const fileExists = await exists(FILE, { baseDir: BASE });
      if (!fileExists) return {};
      const content = await readTextFile(FILE, { baseDir: BASE });
      return JSON.parse(content) as WorkspaceState;
    } catch {
      return {};
    }
  },

  set(state: Partial<WorkspaceState>): void {
    // 合并挂起的状态
    this._pendingState = { ...this._pendingState, ...state };
    
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    
    this._debounceTimer = setTimeout(() => {
      const stateToWrite = { ...this._pendingState };
      this._pendingState = {};
      
      this._writeQueue = this._writeQueue
        .then(async () => {
          try {
            const current = await this.get();
            const next = { ...current, ...stateToWrite };
            await writeTextFile(FILE, JSON.stringify(next, null, 2), {
              baseDir: BASE,
            });
          } catch {
            // 存储失败不应影响应用运行
          }
        })
        .catch(() => {});
    }, 500); // 500ms 防抖
  },
};
