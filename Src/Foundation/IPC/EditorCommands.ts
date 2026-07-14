import { invoke } from "@tauri-apps/api/core";

const documentOperations = new Map<string, Promise<void>>();
const documentFailures = new Map<string, Error>();
const documentFailureListeners = new Map<string, Set<(error: Error) => void>>();

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function reportDocumentFailure(path: string, error: unknown) {
  const normalizedError = toError(error);
  documentFailures.set(path, normalizedError);
  documentFailureListeners.get(path)?.forEach((listener) => {
    listener(normalizedError);
  });
}

function enqueueDocumentOperation<T>(
  path: string,
  operation: () => Promise<T>,
  trackFailure = true,
): Promise<T> {
  const previous = documentOperations.get(path) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  if (trackFailure) current.catch((error) => reportDocumentFailure(path, error));
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
  open: async (path: string) => {
    const content = await invoke<string>("open_editor_file", { path });
    documentFailures.delete(path);
    return content;
  },

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
    enqueueDocumentOperation(
      path,
      () =>
        invoke<LineRenderData[]>("get_editor_lines", {
          path,
          start_line: startLine,
          end_line: endLine,
        }),
      false,
    ),

  save: async (path: string) => {
    await EditorIPC.waitForIdle(path);
    return enqueueDocumentOperation(path, () => invoke<number>("save_editor_file", { path }));
  },

  waitForIdle: async (path: string) => {
    await (documentOperations.get(path) ?? Promise.resolve());
    const failure = documentFailures.get(path);
    if (failure) throw failure;
  },

  onSyncError: (path: string, listener: (error: Error) => void) => {
    const listeners = documentFailureListeners.get(path) ?? new Set();
    listeners.add(listener);
    documentFailureListeners.set(path, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) documentFailureListeners.delete(path);
    };
  },

  clearSyncError: (path: string) => documentFailures.delete(path),

  close: (path: string) =>
    enqueueDocumentOperation(
      path,
      async () => {
        try {
          await invoke<void>("close_editor_file", { path });
        } finally {
          documentOperations.delete(path);
        }
      },
      false,
    ),
};
