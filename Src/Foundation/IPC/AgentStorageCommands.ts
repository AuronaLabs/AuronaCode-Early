import { invokeDesktop } from "../Desktop/Transport";

export type AgentStorageSlot = "sessions" | "checkpoints" | "journal" | "legacy-chat";
export const AgentStorageIPC = {
  read: (slot: AgentStorageSlot) => invokeDesktop<string | null>("agent_storage_read", { slot }),
  write: (slot: AgentStorageSlot, content: string) =>
    invokeDesktop<void>("agent_storage_write", { slot, content }),
};
