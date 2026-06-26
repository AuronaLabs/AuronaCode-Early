import type { TabItem } from "../Types/Tab";
import type { TerminalInstance } from "../Types/Terminal";

/**
 * 全局事件类型映射表。
 * 命名规范：<域>:<动作>[-<细节>]
 * 所有类型引用自 Foundation/Types，不依赖任何上层模块。
 */
export interface EventMap {
  // 应用级
  "app:reboot": undefined;
  "app:open-file": undefined;
  "app:open-folder": undefined;
  "app:save-file": undefined;
  "app:open-tab": TabItem;
  "app:activity-changed": string | null;
  "app:toast": { message: string; type: "info" | "success" | "error" | "warning" };
  // 终端面板
  /** payload 为 true 强制展开，false 强制收起，undefined 切换 */
  "app:toggle-terminal": boolean | undefined;
  "app:terminal-state-changed": boolean;
  // 编辑器
  "app:active-file-changed": string | null;
  "editor:dirty-set": { path: string };
  "editor:dirty-cleared": { path: string };
  "editor:file-saved": { path: string };
  "editor:action": "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";
  // 文件系统
  "file:renamed": { oldPath: string; newPath: string };
  "file:deleted": { path: string; isDirectory: boolean };
  // 工作区
  "workspace:root-changed": string;
  "app:create-file-prompt": undefined;
  "app:create-folder-prompt": undefined;
  // 终端管理
  "terminal:list-changed": TerminalInstance[];
  "terminal:active-changed": string | null;
  // 源代码管理
  "git:changes-count": number;
  // 设置
  "settings:nav": "appearance" | "editor" | "terminal" | "git" | "advanced";
  "settings:editor-changed": undefined;
  "settings:terminal-changed": undefined;
  "lsp:diagnostics": any;
}

type EventCallback<T = unknown> = (payload: T) => void;

class EventBusImpl {
  private readonly listeners = {} as {
    [K in keyof EventMap]?: EventCallback<EventMap[K]>[];
  };

  on<K extends keyof EventMap>(
    event: K,
    callback: EventCallback<EventMap[K]>
  ): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(callback);
    return () => this.off(event, callback);
  }

  off<K extends keyof EventMap>(
    event: K,
    callback: EventCallback<EventMap[K]>
  ): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event]!.filter(
      (cb) => cb !== callback
    ) as any;
  }

  emit<K extends keyof EventMap>(event: K, payload?: EventMap[K]): void {
    this.listeners[event]?.forEach((cb) => cb(payload as EventMap[K]));
  }
}

export const EventBus = new EventBusImpl();
