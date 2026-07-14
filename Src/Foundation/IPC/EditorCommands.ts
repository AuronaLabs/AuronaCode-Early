import { invoke } from "@tauri-apps/api/core";

const documentOperations = new Map<string, Promise<void>>();

function enqueueDocumentOperation<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = documentOperations.get(path) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  documentOperations.set(
    path,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}

export interface LineRenderData {
  text: string;
  tokens: number[];
}

export const EditorIPC = {
  open: (path: string) => invoke<string>("open_editor_file", { path }),

  applyEdit: (path: string, startUtf16: number, endUtf16: number, text: string) =>
    enqueueDocumentOperation(path, () =>
      invoke<number>("apply_editor_edit", {
        path,
        start_utf16: startUtf16,
        end_utf16: endUtf16,
        text,
      }),
    ),

  getLines: (path: string, startLine: number, endLine: number) =>
    enqueueDocumentOperation(path, () =>
      invoke<LineRenderData[]>("get_editor_lines", {
        path,
        start_line: startLine,
        end_line: endLine,
      }),
    ),

  save: (path: string) =>
    enqueueDocumentOperation(path, () => invoke<void>("save_editor_file", { path })),

  close: (path: string) =>
    enqueueDocumentOperation(path, async () => {
      try {
        await invoke<void>("close_editor_file", { path });
      } finally {
        documentOperations.delete(path);
      }
    }),
};
