// StorageManager 现已委托至 Foundation/Storage 层
// 保留向后兼容接口，供现有调用方无感知使用
import { WorkspaceStore } from "../Foundation/Storage/WorkspaceStore";
import type { WorkspaceState } from "../Foundation/Types/Config";

// 兼容旧接口 WorkspaceConfig
export type WorkspaceConfig = WorkspaceState;

export const StorageManager = {
  async init(): Promise<void> {
    await WorkspaceStore.init();
  },

  async getConfig(): Promise<WorkspaceConfig> {
    return WorkspaceStore.get();
  },

  saveConfig(config: Partial<WorkspaceConfig>): void {
    WorkspaceStore.set(config);
  },
};
