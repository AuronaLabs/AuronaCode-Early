import { invokeDesktop } from "../Desktop";
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

export const AuronaChannel = {
  async request<T = unknown>(action: string, payload?: unknown): Promise<T> {
    try {
      const response = await invokeDesktop<IpcResponse<T>>("aurona_bridge", {
        req: { action, payload },
      });
      if (!response.success) throw new Error(response.error || "Unknown IPC Error");
      return response.data as T;
    } catch (cause: unknown) {
      const error = toError(cause);
      Logger.error(`IPC request failed: ${action}`, error);
      throw error;
    }
  },
};
