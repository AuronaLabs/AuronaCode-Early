import { invokeDesktop, listenDesktop } from "../Desktop";
import type { ShellProfile } from "../Types/Terminal";

export const PtyIPC = {
  spawn: (id: string, cwd: string, shellPath?: string, sessionId = crypto.randomUUID()) =>
    invokeDesktop<void>("spawn_pty", { id, cwd, shellPath, sessionId }),

  write: (id: string, data: string) => invokeDesktop<void>("write_pty", { id, data }),

  resize: (id: string, rows: number, cols: number) =>
    invokeDesktop<void>("resize_pty", { id, rows, cols }),

  close: (id: string, sessionId?: string) => invokeDesktop<void>("close_pty", { id, sessionId }),
  acknowledge: (id: string, sessionId: string, seq: number) =>
    invokeDesktop<void>("acknowledge_pty", { id, sessionId, seq }),

  getAvailableShells: () => invokeDesktop<ShellProfile[]>("get_available_shells"),

  listenOutput: (
    listener: (payload: { id: string; session_id: string; seq: number; data: string }) => void,
  ) => listenDesktop("pty-output", listener),

  listenExit: (listener: (payload: { id: string; session_id: string; reason: string }) => void) =>
    listenDesktop("pty-exit", listener),
};
