import type { TabItem } from "../Types/Tab";
import type { TerminalInstance } from "../Types/Terminal";

export interface EventMap {
  "app:reboot": undefined;
  "app:open-file": undefined;
  "app:open-folder": undefined;
  "app:save-file": undefined;
  "app:open-tab": TabItem;
  "app:activity-changed": string | null;
  "app:toast": { message: string; type: "info" | "success" | "error" | "warning" };

  "app:toggle-terminal": boolean | undefined;
  "app:terminal-state-changed": boolean;
  "app:open-terminal-at": string;
  "app:reveal-in-explorer": string;

  "app:active-file-changed": string | null;
  "editor:dirty-set": { path: string };
  "editor:dirty-cleared": { path: string };
  "editor:file-saved": { path: string };
  "editor:action": "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";

  "file:renamed": { oldPath: string; newPath: string };
  "file:deleted": { path: string; isDirectory: boolean };

  "workspace:root-changed": string;
  "app:create-file-prompt": undefined;
  "app:create-folder-prompt": undefined;

  "terminal:list-changed": TerminalInstance[];
  "terminal:active-changed": string | null;

  "git:changes-count": number;

  "settings:nav": "appearance" | "editor" | "terminal" | "git" | "advanced";
  "settings:editor-changed": undefined;
  "settings:terminal-changed": undefined;
  "lsp:diagnostics": any;
  "app:update-available": any;
  "app:update-progress": { progress: number; total?: number; current?: number } | any;
  "app:show-update-modal": undefined;
  "fs:changed": any;
}

type EventCallback<T = unknown> = (payload: T) => void;

class EventBusImpl {
  private readonly listeners = {} as {
    [K in keyof EventMap]?: EventCallback<EventMap[K]>[];
  };

  on<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]?.push(callback);
    return () => this.off(event, callback);
  }

  off<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event]?.filter((cb) => cb !== callback) as any;
  }

  emit<K extends keyof EventMap>(event: K, payload?: EventMap[K]): void {
    this.listeners[event]?.forEach((cb) => cb(payload as EventMap[K]));
  }
}

export const EventBus = new EventBusImpl();
