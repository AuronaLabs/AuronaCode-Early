import type { UpdateInfo, UpdateProgress } from "../Desktop";
import type { DebugPreferences } from "../Types/Config";
import type { SettingCategory } from "../Types/Settings";
import type { TabItem } from "../Types/Tab";
import type { TerminalInstance } from "../Types/Terminal";

export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number;
  message: string;
  source?: string;
}

export interface LspDiagnosticsPayload {
  uri: string;
  diagnostics: LspDiagnostic[];
  version?: number;
}

export interface FileSystemChangePayload {
  type: unknown;
  paths: string[];
}

export interface EventMap {
  "app:reboot": undefined;
  "app:open-file": undefined;
  "app:open-folder": undefined;
  "app:save-file": undefined;
  "app:open-tab": TabItem;
  "app:toast": {
    id?: string;
    title?: string;
    message: string;
    type: "info" | "success" | "error" | "warning" | "confirm";
    duration?: number | null;
    actions?: Array<{
      label: string;
      primary?: boolean;
      variant?: "default" | "primary" | "danger" | "secondary";
      onClick?: () => void | Promise<void>;
    }>;
    onDismiss?: () => void;
  };
  "app:show-fliuno": undefined;

  "app:toggle-terminal": boolean | undefined;
  "app:open-terminal-at": string;
  "app:reveal-in-explorer": string;

  "editor:dirty-set": { path: string };
  "editor:dirty-cleared": { path: string };
  "editor:file-saved": { path: string };
  "editor:reveal-location": { path: string; line: number };
  "language:rename-request": {
    path: string;
    language: string;
    line: number;
    character: number;
  };
  "language:code-actions-request": {
    path: string;
    language: string;
    line: number;
    character: number;
  };
  "language:open-location-results": undefined;
  "language:symbol-search-request": { path: string; language: string };
  "workspace:trust-request": { root: string; language: string };

  "file:renamed": { oldPath: string; newPath: string };
  "file:deleted": { path: string; isDirectory: boolean };

  "workspace:root-changed": string;
  "app:create-file-prompt": undefined;
  "app:create-folder-prompt": undefined;

  "terminal:list-changed": TerminalInstance[];
  "terminal:active-changed": string | null;

  "git:changes-count": number;

  "settings:nav":
    | "general"
    | "appearance"
    | "editor"
    | "codeIntelligence"
    | "terminalRun"
    | "sourceControl"
    | "network"
    | "accountCloud"
    | "extensions"
    | "system"
    | "advanced";
  "settings:reveal": { category: SettingCategory; settingId?: string };
  "marketplace:navigate": {
    mode?: "discover" | "installed" | "toolchains";
    selectedId?: string;
  };
  "settings:editor-changed": undefined;
  "settings:language-changed": undefined;
  "settings:debug-changed": DebugPreferences;
  "settings:terminal-changed": undefined;
  "lsp:diagnostics": LspDiagnosticsPayload;
  "app:update-available": UpdateInfo;
  "app:update-progress": UpdateProgress;
  "app:show-update-modal": undefined;
  "fs:changed": FileSystemChangePayload;
}

type EventCallback<T = unknown> = (payload: T) => void;

class EventBusImpl {
  private readonly listeners = {} as {
    [K in keyof EventMap]?: EventCallback<EventMap[K]>[];
  };

  /**
   * 注册持久事件监听器
   */
  on<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]?.push(callback);
    return () => this.off(event, callback);
  }

  /**
   * 注册一次性事件监听器，触发后自动销毁，防止内存泄漏
   */
  once<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): () => void {
    const onceWrapper: EventCallback<EventMap[K]> = (payload) => {
      this.off(event, onceWrapper);
      callback(payload);
    };
    return this.on(event, onceWrapper);
  }

  /**
   * 注销指定事件监听器
   */
  off<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): void {
    const listeners = this.listeners[event];
    if (!listeners) return;
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  }

  /**
   * 派发系统级事件，具备单点故障异常隔离保护。
   * 无负载事件（EventMap 值为 undefined 或含 undefined）可省略 payload；
   * 有负载事件漏传 payload 会在编译期报错。
   */
  emit<K extends keyof EventMap>(
    event: K,
    ...args: undefined extends EventMap[K] ? [payload?: EventMap[K]] : [payload: EventMap[K]]
  ): void {
    const currentListeners = [...(this.listeners[event] ?? [])];
    for (const callback of currentListeners) {
      try {
        callback(args[0] as EventMap[K]);
      } catch (error) {
        console.error(`[EventBus] 事件 ${String(event)} 处理器执行异常:`, error);
      }
    }
  }
}

export const EventBus = new EventBusImpl();
