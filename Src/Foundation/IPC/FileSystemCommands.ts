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
  generation: () => invokeDesktop<number>("workspace_generation"),
  writeCompare: (path: string, contents: string, expectedFingerprint: string, generation: number) =>
    invokeDesktop<void>("fs_write_compare", { path, contents, expectedFingerprint, generation }),
  restoreDeleted(recoveryId: string): Promise<string> {
    return invokeDesktop("fs_restore_deleted", { recoveryId });
  },
  setWorkspaceRoot: (root: string | null) => invokeDesktop<void>("workspace_set_root", { root }),

  readDirectory: (path: string) => invokeDesktop<FileSystemEntry[]>("fs_read_dir", { path }),
  readDirectoryPage: (path: string, cursor?: string) =>
    invokeDesktop<{ entries: FileSystemEntry[]; nextCursor: string | null; generation: number }>(
      "fs_read_dir_page",
      { path, cursor: cursor ?? null },
    ),
  cancelDirectoryCursor: (cursor: string) =>
    invokeDesktop<void>("fs_cancel_dir_cursor", { cursor }),

  exists: (path: string) => invokeDesktop<boolean>("fs_exists", { path }),

  readTextFile: (path: string) => invokeDesktop<string>("fs_read_text_file", { path }),

  readImageDataUrl: (path: string) => invokeDesktop<string>("fs_read_image_data_url", { path }),

  async writeTextFile(path: string, contents: string): Promise<void> {
    const bytes = new TextEncoder().encode(contents).length;
    if (bytes <= 256 * 1024) return invokeDesktop<void>("fs_write_text_file", { path, contents });
    const uploadId = await invokeDesktop<string>("fs_write_begin", { path, sizeBytes: bytes });
    try {
      let offset = 0;
      for (let start = 0; start < contents.length; ) {
        let end = Math.min(start + 64 * 1024, contents.length);
        const last = contents.charCodeAt(end - 1);
        if (end < contents.length && last >= 0xd800 && last <= 0xdbff) end--;
        const chunk = contents.slice(start, end);
        await invokeDesktop<void>("fs_write_chunk", { uploadId, offset, contents: chunk });
        offset += new TextEncoder().encode(chunk).length;
        start = end;
      }
      await invokeDesktop<void>("fs_write_commit", { uploadId });
    } finally {
      await invokeDesktop<void>("fs_write_cancel", { uploadId }).catch(() => undefined);
    }
  },

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

  copyOrMove: (source: string, destination: string, isMove: boolean) =>
    invokeDesktop<void>("fs_copy_or_move", {
      source,
      destination,
      isMove,
    }),
};
