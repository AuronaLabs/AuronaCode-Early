import { invokeDesktop, listenDesktop } from "../Desktop";

export interface FileSystemEntry {
  name: string;
  isDirectory: boolean;
}

export interface FileSystemChangedPayload {
  id: string;
  kind: string;
  paths: string[];
}

export const FileSystemCommands = {
  setWorkspaceRoot: (root: string | null) => invokeDesktop<void>("workspace_set_root", { root }),

  readDirectory: (path: string) => invokeDesktop<FileSystemEntry[]>("fs_read_dir", { path }),

  exists: (path: string) => invokeDesktop<boolean>("fs_exists", { path }),

  readTextFile: (path: string) => invokeDesktop<string>("fs_read_text_file", { path }),

  writeTextFile: (path: string, contents: string) =>
    invokeDesktop<void>("fs_write_text_file", { path, contents }),

  mkdir: (path: string, recursive: boolean) => invokeDesktop<void>("fs_mkdir", { path, recursive }),

  remove: (path: string, recursive: boolean) =>
    invokeDesktop<void>("fs_remove", { path, recursive }),

  rename: (from: string, to: string) => invokeDesktop<void>("fs_rename", { from, to }),

  exportDialogFile: (contents: string, defaultName: string) =>
    invokeDesktop<string | null>("fs_export_dialog_file", {
      contents,
      defaultName,
    }),

  startWatch: (path: string, recursive: boolean) =>
    invokeDesktop<string>("fs_watch_start", { path, recursive }),

  stopWatch: (id: string) => invokeDesktop<void>("fs_watch_stop", { id }),

  listenChanged: (listener: (payload: FileSystemChangedPayload) => void) =>
    listenDesktop("fs:changed", listener),

  revealInOs: (path: string) => invokeDesktop<void>("reveal_in_os", { path }),

  copyOrMove: (workspaceRoot: string, source: string, destination: string, isMove: boolean) =>
    invokeDesktop<void>("fs_copy_or_move", {
      workspaceRoot,
      source,
      destination,
      isMove,
    }),
};
