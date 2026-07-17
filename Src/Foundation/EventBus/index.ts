import type { UpdateInfo, UpdateProgress } from "../Desktop";
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
  "app:toast": { message: string; type: "info" | "success" | "error" | "warning" };
  "app:show-command-palette": undefined;

  "app:toggle-terminal": boolean | undefined;
  "app:open-terminal-at": string;
  "app:reveal-in-explorer": string;

  "editor:dirty-set": { path: string };
  "editor:dirty-cleared": { path: string };
  "editor:file-saved": { path: string };

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

  on<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]?.push(callback);
    return () => this.off(event, callback);
  }

  off<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): void {
    const listeners = this.listeners[event];
    if (!listeners) return;
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  }

  emit<K extends keyof EventMap>(event: K, payload?: EventMap[K]): void {
    [...(this.listeners[event] ?? [])].forEach((callback) => {
      callback(payload as EventMap[K]);
    });
  }
}

export const EventBus = new EventBusImpl();
