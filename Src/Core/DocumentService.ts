import {
  EditorIPC,
  type EditorSnapshot,
  type SaveEditorResponse,
  type TextEdit,
} from "../Foundation/IPC/EditorCommands";
import { GetLanguageFromPath } from "../Shared/Utils/LanguageUtils";
import { LspClient } from "./Language/LspClient";
import { OutputService } from "./OutputService";

export type DocumentOpenState = "opening" | "open" | "closing" | "closed" | "error";
export type DocumentSaveState = "idle" | "saving" | "error";
export type DocumentChangeOrigin = "local" | "external" | "save";

export interface DocumentRecord {
  uri?: string;
  path: string;
  languageId: string;
  content: string;
  savedContent?: string;
  version: number;
  savedVersion: number;
  isDirty: boolean;
  isReadonly: boolean;
  encoding: "UTF-8";
  lineEnding: "LF" | "CRLF";
  openState: DocumentOpenState;
  saveState: DocumentSaveState;
  diskFingerprint: string;
  /** Identifies the source of the last content notification for tab syncing. */
  changeOrigin?: DocumentChangeOrigin;
  lastError?: string;
}

type Listener = (record: DocumentRecord | undefined) => void;

class DocumentServiceImpl {
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly languageSyncs = new Map<string, Promise<void>>();

  get(path: string): DocumentRecord | undefined {
    return this.documents.get(path);
  }

  getAll(): readonly DocumentRecord[] {
    return [...this.documents.values()];
  }

  subscribe(path: string, listener: Listener): () => void {
    const listeners = this.listeners.get(path) ?? new Set();
    listeners.add(listener);
    this.listeners.set(path, listeners);
    listener(this.documents.get(path));
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(path);
    };
  }

  async open(path: string): Promise<DocumentRecord> {
    const existing = this.documents.get(path);
    if (existing?.openState === "open") return existing;
    this.set(path, {
      path,
      languageId: GetLanguageFromPath(path),
      content: "",
      savedContent: "",
      version: 0,
      savedVersion: 0,
      isDirty: false,
      isReadonly: false,
      encoding: "UTF-8",
      lineEnding: "LF",
      openState: "opening",
      saveState: "idle",
      diskFingerprint: "",
    });
    try {
      const snapshot = await EditorIPC.open(path);
      const record = this.fromSnapshot(snapshot);
      this.set(path, record);
      void LspClient.getInstance()
        .didOpen(record.languageId, path, record.content, record.version)
        .then(() => {
          const uri = LspClient.getInstance().getKnownFileUri(path);
          if (uri) this.patch(path, { uri });
        })
        .catch((error) => {
          const message = String(error);
          if (!message.includes("No language server is configured")) {
            OutputService.append(
              "language-server",
              `Unable to open ${path} in the language server: ${message}`,
              "warn",
            );
          }
        });
      return record;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.patch(path, { openState: "error", lastError: message });
      throw error;
    }
  }

  async applyEdit(
    path: string,
    startUtf16: number,
    endUtf16: number,
    text: string,
    nextContent: string,
    origin: DocumentChangeOrigin = "local",
    expectedRevision?: number,
  ): Promise<void> {
    await this.applyEdits(
      path,
      [{ startUtf16, endUtf16, text }],
      nextContent,
      origin,
      expectedRevision,
    );
  }

  async applyEdits(
    path: string,
    edits: TextEdit[],
    nextContent: string,
    origin: DocumentChangeOrigin = "local",
    expectedRevision?: number,
  ): Promise<void> {
    const record = this.require(path);
    try {
      const response = await EditorIPC.applyEdits(path, edits, expectedRevision);
      this.patch(path, {
        content: nextContent,
        version: Math.max(this.require(path).version, response.revision),
        isDirty: response.dirty,
        changeOrigin: origin,
        lastError: undefined,
      });
      const languageSync = LspClient.getInstance()
        .didChange(record.languageId, path, nextContent, response.revision, edits)
        .catch((error) => {
          OutputService.append(
            "language-server",
            `Unable to synchronize ${path}: ${String(error)}`,
            "error",
          );
        });
      this.languageSyncs.set(path, languageSync);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.patch(path, { lastError: message });
      throw error;
    }
  }

  async save(path: string): Promise<SaveEditorResponse> {
    const record = this.require(path);
    this.patch(path, { saveState: "saving" });
    try {
      const response = await EditorIPC.save(path);
      this.patch(path, {
        version: response.revision,
        savedVersion: response.revision,
        savedContent: record.content,
        diskFingerprint: response.diskFingerprint,
        isDirty: this.require(path).version !== response.revision,
        saveState: "idle",
        changeOrigin: "save",
        lastError: undefined,
      });
      void LspClient.getInstance()
        .didSave(record.languageId, path)
        .catch((error) =>
          OutputService.append(
            "language-server",
            `Unable to notify save for ${path}: ${String(error)}`,
            "warn",
          ),
        );
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.patch(path, { saveState: "error", lastError: message });
      throw error;
    }
  }

  async close(path: string, force = false): Promise<void> {
    const record = this.documents.get(path);
    if (!record) return;
    this.patch(path, { openState: "closing" });
    try {
      this.languageSyncs.delete(path);
      await LspClient.getInstance()
        .didClose(record.languageId, path)
        .catch(() => undefined);
      await EditorIPC.close(path, force);
      this.documents.delete(path);
      this.emit(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.patch(path, { openState: "error", lastError: message });
      throw error;
    }
  }

  async closeAll(force = false): Promise<void> {
    for (const path of [...this.documents.keys()]) await this.close(path, force);
  }

  async flush(path: string): Promise<void> {
    await EditorIPC.waitForIdle(path);
    await this.languageSyncs.get(path);
  }

  getLines(path: string, startLine: number, endLine: number) {
    return EditorIPC.getLines(path, startLine, endLine);
  }

  onSyncError(path: string, listener: (error: Error) => void): () => void {
    return EditorIPC.onSyncError(path, listener);
  }

  clearSyncError(path: string): void {
    EditorIPC.clearSyncError(path);
  }

  private fromSnapshot(snapshot: EditorSnapshot): DocumentRecord {
    return {
      uri: LspClient.getInstance().getKnownFileUri(snapshot.path),
      path: snapshot.path,
      languageId: snapshot.language || GetLanguageFromPath(snapshot.path),
      content: snapshot.text,
      savedContent: snapshot.text,
      version: snapshot.revision,
      savedVersion: snapshot.savedRevision,
      isDirty: snapshot.revision !== snapshot.savedRevision,
      isReadonly: false,
      encoding: "UTF-8",
      lineEnding: snapshot.lineEnding === "crlf" ? "CRLF" : "LF",
      openState: "open",
      saveState: "idle",
      diskFingerprint: snapshot.diskFingerprint,
    };
  }

  private require(path: string): DocumentRecord {
    const record = this.documents.get(path);
    if (record?.openState !== "open") {
      throw new Error(`Document is not open: ${path}`);
    }
    return record;
  }

  private set(path: string, record: DocumentRecord): void {
    this.documents.set(path, record);
    this.emit(path);
  }

  private patch(path: string, patch: Partial<DocumentRecord>): void {
    const current = this.documents.get(path);
    if (!current) return;
    this.documents.set(path, { ...current, ...patch });
    this.emit(path);
  }

  private emit(path: string): void {
    const record = this.documents.get(path);
    for (const listener of this.listeners.get(path) ?? []) listener(record);
  }
}

export const DocumentService = new DocumentServiceImpl();
