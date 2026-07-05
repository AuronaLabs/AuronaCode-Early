import { invoke } from "@tauri-apps/api/core";
import type { ShellProfile } from "../Types/Terminal";


export const PtyIPC = {
  spawn: (id: string, cwd: string, shellPath?: string) =>
    invoke<void>("spawn_pty", { id, cwd, shellPath }),

  write: (id: string, data: string) => invoke<void>("write_pty", { id, data }),

  resize: (id: string, rows: number, cols: number) =>
    invoke<void>("resize_pty", { id, rows, cols }),

  close: (id: string) => invoke<void>("close_pty", { id }),

  getAvailableShells: () => invoke<ShellProfile[]>("get_available_shells"),
};
