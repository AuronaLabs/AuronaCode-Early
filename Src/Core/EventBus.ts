import { TabItem } from "../Shared/Types/Tab";
import { TerminalInstance } from "./TerminalService";

export interface EventMap {
  "app:open-file": undefined;
  "app:open-tab": TabItem;
  "app:activity-changed": string | null;
  "app:save-file": undefined;
  "app:toggle-terminal": boolean | undefined;
  "app:terminal-state-changed": boolean;
  "app:active-file-changed": string | null;
  "workspace:root-changed": string;
  "editor:dirty-changed": { path: string; isDirty: boolean };
  "editor:file-saved": { path: string };
  "file:renamed": { oldPath: string; newPath: string };
  "file:deleted": { path: string; isDirectory: boolean };
  "terminal:list-changed": TerminalInstance[];
  "terminal:active-changed": string | null;
  "git:changes-count": number;
}

type EventCallback<T = any> = (payload: T) => void;

class EventBusImpl {
  private listeners: { [K in keyof EventMap]?: EventCallback<EventMap[K]>[] } = {};

  on<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(callback);
    
    return () => this.off(event, callback);
  }

  off<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event]!.filter(cb => cb !== callback);
  }

  emit<K extends keyof EventMap>(event: K, payload?: EventMap[K]) {
    if (!this.listeners[event]) return;
    this.listeners[event]!.forEach(cb => cb(payload as EventMap[K]));
  }
}

export const EventBus = new EventBusImpl();
