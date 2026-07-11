import { invoke } from "@tauri-apps/api/core";
import { EventBus } from "../EventBus";

export interface IpcRequest<T = any> {
  action: string;
  payload?: T;
}

export interface IpcResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class AuronaChannel {
  static async request<T = any>(action: string, payload?: any): Promise<T> {
    try {
      const response: IpcResponse<T> = await invoke("aurona_bridge", {
        req: { action, payload },
      });

      if (!response.success) {
        EventBus.emit("app:toast", { message: `[${action}] ${response.error}`, type: "error" });
        throw new Error(response.error || "Unknown IPC Error");
      }
      return response.data as T;
    } catch (err: any) {
      EventBus.emit("app:toast", {
        message: `IPC Failed [${action}]: ${err.message || err}`,
        type: "error",
      });
      throw err;
    }
  }

  static createStream(channelId: string) {
    console.log(`[IPC] Initializing data stream for: ${channelId}`);
    return {
      onMessage: (callback: (data: any) => void) => {
        return () => {
          console.log(`[IPC] Unsubscribed from stream: ${channelId}`);
        };
      },
      send: (data: any) => {
        console.log(`[IPC] Stream ${channelId} send:`, data);
      },
    };
  }
}
