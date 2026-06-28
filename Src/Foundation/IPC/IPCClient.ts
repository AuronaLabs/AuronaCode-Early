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

/**
 * Aurona Universal IPC Channel
 * Dual-Track System:
 * 1. Control Plane (request/response)
 * 2. Data Plane (streams - pending Tauri v2 Channel implementation)
 */
export class AuronaChannel {
  /**
   * Control Plane: Unified Request/Response router
   */
  static async request<T = any>(action: string, payload?: any): Promise<T> {
    try {
      const response: IpcResponse<T> = await invoke("aurona_bridge", {
        req: { action, payload }
      });
      
      if (!response.success) {
        EventBus.emit("app:toast", { message: `[${action}] ${response.error}`, type: "error" });
        throw new Error(response.error || "Unknown IPC Error");
      }
      return response.data as T;
    } catch (err: any) {
      EventBus.emit("app:toast", { message: `IPC Failed [${action}]: ${err.message || err}`, type: "error" });
      throw err;
    }
  }

  /**
   * Data Plane: High-throughput Bidirectional Stream
   * Placeholder for LSP/DAP protocols using Tauri IPC Channels
   */
  static createStream(channelId: string) {
    console.log(`[IPC] Initializing data stream for: ${channelId}`);
    return {
      onMessage: (callback: (data: any) => void) => {
        // Placeholder for Event Listeners
        return () => {
          console.log(`[IPC] Unsubscribed from stream: ${channelId}`);
        };
      },
      send: (data: any) => {
        console.log(`[IPC] Stream ${channelId} send:`, data);
      }
    };
  }
}
