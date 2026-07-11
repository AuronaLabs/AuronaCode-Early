import { invoke } from "@tauri-apps/api/core";

export interface LineRenderData {
  text: string;
  tokens: number[];
}

export const EditorIPC = {
  open: (path: string) => invoke<string>("open_editor_file", { path }),

  applyEdit: (path: string, startUtf16: number, endUtf16: number, text: string) =>
    invoke<number>("apply_editor_edit", {
      path,
      start_utf16: startUtf16,
      end_utf16: endUtf16,
      text,
    }),

  getLines: (path: string, startLine: number, endLine: number) =>
    invoke<LineRenderData[]>("get_editor_lines", {
      path,
      start_line: startLine,
      end_line: endLine,
    }),

  save: (path: string) => invoke<void>("save_editor_file", { path }),

  close: (path: string) => invoke<void>("close_editor_file", { path }),
};
