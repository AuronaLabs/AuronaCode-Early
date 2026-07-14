import { invoke } from "@tauri-apps/api/core";
import { EventBus } from "../EventBus";
import { Logger } from "../Logger";

export interface IpcRequest<T = unknown> {
  action: string;
  payload?: T;
}

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class AuronaChannel {
  static async request<T = unknown>(action: string, payload?: unknown): Promise<T> {
    try {
      const response: IpcResponse<T> = await invoke("aurona_bridge", {
        req: { action, payload },
      });

      if (!response.success) {
        throw new Error(response.error || "Unknown IPC Error");
      }
      return response.data as T;
    } catch (cause: unknown) {
      const error = toError(cause);
      Logger.error(`IPC request failed: ${action}`, error);
      EventBus.emit("app:toast", {
        message: `IPC Failed [${action}]: ${error.message}`,
        type: "error",
      });
      throw error;
    }
  }

  static createStream(channelId: string) {
    console.log(`[IPC] Initializing data stream for: ${channelId}`);
    return {
      onMessage: (_callback: (data: unknown) => void) => {
        return () => {
          console.log(`[IPC] Unsubscribed from stream: ${channelId}`);
        };
      },
      send: (data: unknown) => {
        console.log(`[IPC] Stream ${channelId} send:`, data);
      },
    };
  }
}
