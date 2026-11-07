export { prepareDocumentEdits } from "./DocumentEdits";

import {
  EditorIPC,
  type EditorSnapshot,
  type SaveEditorResponse,
  type TextEdit,
} from "../../Foundation/IPC/EditorCommands";
import { GetLanguageFromPath } from "../../Shared/Utils/LanguageUtils";
import { type DocumentLanguageSync, noLanguageSync } from "./DocumentLanguageSync";

export type { DocumentLanguageSync } from "./DocumentLanguageSync";

import { OutputService } from "../OutputService";
import { WorkspaceService } from "../Workspace";

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

export type DocumentEvent = {
  type: "opened" | "changed" | "saved" | "closed";
  document: DocumentRecord;
};

type Listener = (record: DocumentRecord | undefined) => void;

class DocumentServiceImpl {
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly languageSyncs = new Map<string, Promise<void>>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly openings = new Map<string, Promise<DocumentRecord>>();
  private readonly sessions = new Map<string, { id: symbol; language: DocumentLanguageSync }>();
  private readonly observers = new Set<(event: DocumentEvent) => void>();
  private language: DocumentLanguageSync = noLanguageSync;

  registerLanguageSync(adapter: DocumentLanguageSync): () => void {
    this.language = adapter;
    return () => {
      if (this.language === adapter) this.language = noLanguageSync;
    };
  }

  private enqueue<T>(path: string, work: () => Promise<T>): Promise<T> {
    const operation = (this.operations.get(path) ?? Promise.resolve())
      .catch(() => undefined)
      .then(work);
    this.operations.set(path, operation);
    void operation
      .finally(() => {
        if (this.operations.get(path) === operation) this.operations.delete(path);
      })
      .catch(() => undefined);
    return operation;
  }

  subscribeEvents(listener: (event: DocumentEvent) => void): () => void {
    this.observers.add(listener);
    return () => {
      this.observers.delete(listener);
    };
  }

  private notify(type: DocumentEvent["type"], document: DocumentRecord): void {
    for (const listener of this.observers) {
      try {
        listener({ type, document });
      } catch (error) {
        console.error("Document event listener failed", error);
      }
    }
  }

  private syncLanguage(path: string, operation: () => Promise<void>): Promise<void> {
    const sync = (this.languageSyncs.get(path) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation)
      .catch((error) => {
        if (!String(error).includes("No language server is configured")) {
          OutputService.append(
            "language-server",
            `Unable to synchronize ${path}: ${String(error)}`,
            "warn",
          );
        }
      });
    this.languageSyncs.set(path, sync);
    void sync.finally(() => {
      if (this.languageSyncs.get(path) === sync) this.languageSyncs.delete(path);
    });
    return sync;
  }

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

  open(path: string): Promise<DocumentRecord> {
    const pending = this.openings.get(path);
    if (pending) return pending;
    const opening = this.enqueue(path, () => this.openDocument(path));
    this.openings.set(path, opening);
    void opening
      .finally(() => {
        if (this.openings.get(path) === opening) this.openings.delete(path);
      })
      .catch(() => undefined);
    return opening;
  }

  private async openDocument(path: string): Promise<DocumentRecord> {
    await WorkspaceService.whenInitialized();
    const existing = this.documents.get(path);
    if (existing?.openState === "open") return existing;
    const language = this.language;
    const session = { id: Symbol(path), language };
    this.sessions.set(path, session);
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
      const record = this.fromSnapshot(snapshot, language);
      this.set(path, record);
      this.notify("opened", record);
      void this.syncLanguage(path, async () => {
        await language.open(record.languageId, path, record.content, record.version);
        const uri = language.fileUri(path);
        if (
          uri &&
          this.sessions.get(path) === session &&
          this.documents.get(path)?.openState === "open"
        ) {
          this.patch(path, { uri });
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
    return this.enqueue(path, async () => {
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
        this.notify("changed", this.require(path));
        const language = this.sessions.get(path)?.language ?? this.language;
        void this.syncLanguage(path, () =>
          language.change(record.languageId, path, nextContent, response.revision, edits),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.patch(path, { lastError: message });
        throw error;
      }
    });
  }

  async save(path: string): Promise<SaveEditorResponse> {
    return this.enqueue(path, async () => {
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
        this.notify("saved", this.require(path));
        const language = this.sessions.get(path)?.language ?? this.language;
        void this.syncLanguage(path, () => language.save(record.languageId, path));
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.patch(path, { saveState: "error", lastError: message });
        throw error;
      }
    });
  }

  async close(path: string, force = false): Promise<void> {
    // A new open after this call belongs after the close, even while the first open is pending.
    this.openings.delete(path);
    return this.enqueue(path, async () => {
      const record = this.documents.get(path);
      if (!record) return;
      this.patch(path, { openState: "closing" });
      try {
        await EditorIPC.close(path, force);
        this.documents.delete(path);
        const language = this.sessions.get(path)?.language ?? this.language;
        this.sessions.delete(path);
        this.emit(path);
        this.notify("closed", record);
        void this.syncLanguage(path, () => language.close(record.languageId, path));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.patch(path, { openState: record.openState, lastError: message });
        throw error;
      }
    });
  }

  async closeAll(force = false): Promise<void> {
    for (const path of new Set([...this.documents.keys(), ...this.openings.keys()]))
      await this.close(path, force);
  }

  async flush(path: string): Promise<void> {
    await this.operations.get(path);
    await EditorIPC.waitForIdle(path);
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

  private fromSnapshot(snapshot: EditorSnapshot, language: DocumentLanguageSync): DocumentRecord {
    return {
      uri: language.fileUri(snapshot.path),
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
