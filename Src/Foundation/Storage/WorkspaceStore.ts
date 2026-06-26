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

// 写入队列：避免并发调用导致的 Race Condition
let writeQueue: Promise<void> = Promise.resolve();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingState: Partial<WorkspaceState> = {};

export const WorkspaceStore = {
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

  // 非阻塞写入，通过队列保证顺序与防抖
  set(state: Partial<WorkspaceState>): void {
    // 合并挂起的状态
    pendingState = { ...pendingState, ...state };
    
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    debounceTimer = setTimeout(() => {
      const stateToWrite = { ...pendingState };
      pendingState = {};
      
      writeQueue = writeQueue
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
