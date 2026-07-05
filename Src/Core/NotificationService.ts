import { EventBus } from "../Foundation/EventBus";

export interface NotificationItem {
  id: string;
  type: "info" | "success" | "warning" | "error";
  message: string;
  timestamp: number;
  read: boolean;
}

class NotificationServiceImpl {
  private history: NotificationItem[] = [];
  private unsubToast: (() => void) | null = null;

  constructor() {
    this.unsubToast = EventBus.on("app:toast", (payload) => {
      this.add({
        id: Date.now().toString() + Math.random().toString(),
        type: payload.type,
        message: payload.message,
        timestamp: Date.now(),
        read: false,
      });
    });
  }

  public destroy() {
    if (this.unsubToast) {
      this.unsubToast();
      this.unsubToast = null;
    }
  }

  private add(item: NotificationItem) {
    this.history = [item, ...this.history].slice(0, 100); 
    EventBus.emit("notifications:updated", this.history);
  }

  public getHistory(): NotificationItem[] {
    return this.history;
  }

  public clearAll() {
    this.history = [];
    EventBus.emit("notifications:updated", this.history);
  }

  public markAllAsRead() {
    this.history = this.history.map((item) => ({ ...item, read: true }));
    EventBus.emit("notifications:updated", this.history);
  }

  public getUnreadCount() {
    return this.history.filter((item) => !item.read).length;
  }
}


declare module "../Foundation/EventBus" {
  interface EventMap {
    "notifications:updated": NotificationItem[];
  }
}

export const NotificationService = new NotificationServiceImpl();
