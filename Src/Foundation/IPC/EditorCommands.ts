import { invokeDesktop } from "../Desktop";

const documentOperations = new Map<string, Promise<void>>();
const documentFailures = new Map<string, Error>();
const documentFailureListeners = new Map<string, Set<(error: Error) => void>>();
const documentRevisions = new Map<string, number>();
const documentFingerprints = new Map<string, string>();

export interface EditorSnapshot {
  path: string;
  revision: number;
  savedRevision: number;
  text: string;
  lineEnding: "lf" | "crlf";
  language: string;
  lineCount: number;
  diskFingerprint: string;
}

export interface TextEdit {
  /** Offsets are interpreted sequentially against the result of prior edits in the batch. */
  startUtf16: number;
  endUtf16: number;
  text: string;
}

export interface ApplyEditsResponse {
  revision: number;
  lineCount: number;
  dirty: boolean;
}

export interface LineRenderData {
  text: string;
  tokens: number[];
}

export interface EditorLinesResponse {
  revision: number;
  startLine: number;
  lines: LineRenderData[];
}

export interface SaveEditorResponse {
  revision: number;
  diskFingerprint: string;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function batchId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
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

export const EditorIPC = {
  open: async (path: string): Promise<EditorSnapshot> => {
    const snapshot = await invokeDesktop<EditorSnapshot>("open_editor_file", { path });
    documentRevisions.set(path, snapshot.revision);
    documentFingerprints.set(path, snapshot.diskFingerprint);
    documentFailures.delete(path);
    return snapshot;
  },

  applyEdits: (path: string, edits: TextEdit[]) =>
    enqueueDocumentOperation(path, async () => {
      const baseRevision = documentRevisions.get(path);
      if (baseRevision === undefined) throw new Error("编辑器会话尚未打开");
      const response = await invokeDesktop<ApplyEditsResponse>("apply_editor_edits", {
        request: {
          path,
          baseRevision,
          clientBatchId: batchId(),
          edits,
        },
      });
      documentRevisions.set(path, response.revision);
      return response;
    }),

  applyEdit: (path: string, startUtf16: number, endUtf16: number, text: string) =>
    EditorIPC.applyEdits(path, [{ startUtf16, endUtf16, text }]),

  getLines: (path: string, startLine: number, endLine: number) =>
    enqueueDocumentOperation(
      path,
      async () => {
        const response = await invokeDesktop<EditorLinesResponse>("get_editor_lines", {
          path,
          start_line: startLine,
          end_line: endLine,
        });
        if (response.revision !== documentRevisions.get(path)) {
          return { ...response, lines: [] };
        }
        return response;
      },
      false,
    ),

  save: (path: string) =>
    enqueueDocumentOperation(path, async () => {
      const failure = documentFailures.get(path);
      if (failure) throw failure;
      const expectedRevision = documentRevisions.get(path);
      const diskFingerprint = documentFingerprints.get(path);
      if (expectedRevision === undefined || diskFingerprint === undefined) {
        throw new Error("编辑器会话尚未打开");
      }
      const response = await invokeDesktop<SaveEditorResponse>("save_editor_file", {
        request: { path, expectedRevision, diskFingerprint },
      });
      documentRevisions.set(path, response.revision);
      documentFingerprints.set(path, response.diskFingerprint);
      return response;
    }),

  waitForIdle: async (path: string) => {
    await (documentOperations.get(path) ?? Promise.resolve());
    const failure = documentFailures.get(path);
    if (failure) throw failure;
  },

  getRevision: (path: string) => documentRevisions.get(path),

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

  close: (path: string, force = false) =>
    enqueueDocumentOperation(
      path,
      async () => {
        try {
          await invokeDesktop<void>("close_editor_file", { path, force });
          documentRevisions.delete(path);
          documentFingerprints.delete(path);
          documentFailures.delete(path);
        } finally {
          documentOperations.delete(path);
        }
      },
      false,
    ),
};
