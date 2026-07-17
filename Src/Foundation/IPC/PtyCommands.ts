import { invokeDesktop } from "../Desktop";
import type { ShellProfile } from "../Types/Terminal";

export const PtyIPC = {
  spawn: (id: string, cwd: string, shellPath?: string) =>
    invokeDesktop<void>("spawn_pty", { id, cwd, shellPath }),

  write: (id: string, data: string) => invokeDesktop<void>("write_pty", { id, data }),

  resize: (id: string, rows: number, cols: number) =>
    invokeDesktop<void>("resize_pty", { id, rows, cols }),

  close: (id: string) => invokeDesktop<void>("close_pty", { id }),

  getAvailableShells: () => invokeDesktop<ShellProfile[]>("get_available_shells"),
};
