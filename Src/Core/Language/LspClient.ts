import { EventBus } from "../../Foundation/EventBus";
import {
  type LspContentChangePayload,
  LanguageServerIPC,
} from "../../Foundation/IPC/LanguageServerCommands";
import type { CompletionItem } from "../../Foundation/Types/Lsp";
import { type DiagnosticItem, DiagnosticsService } from "../DiagnosticsService";
import { DocumentService } from "../DocumentService";
import { OutputService } from "../OutputService";
import {
  type LspPosition,
  normalizePositionEncoding,
  positionForEncoding,
  utf16OffsetToPosition,
} from "./Position";

/** 编辑器 TextEdit（绝对 UTF-16 偏移） */
interface EditorTextEdit {
  startUtf16: number;
  endUtf16: number;
  text: string;
}

export type LanguageServerStatus =
  | "stopped"
  | "starting"
  | "initializing"
  | "running"
  | "restarting"
  | "failed"
  | "stopping";

export interface LanguageServerInfo {
  language: string;
  status: LanguageServerStatus;
  command: string;
  args: string[];
  workspaceRoot: string | null;
  capabilities: Record<string, unknown>;
  positionEncoding: "utf-8" | "utf-16" | string;
  startedAtMs: number | null;
  processId: number | null;
  restartCount: number;
  lastError: string | null;
}

interface DiagnosticsEventPayload {
  params?: {
    uri: string;
    diagnostics: DiagnosticItem[];
    version?: number;
  };
}

interface LanguageServerLogPayload {
  language?: string;
  level?: "debug" | "info" | "warn" | "error";
  source?: string;
  message: string;
}

export type CompletionResponse = CompletionItem[] | { items?: CompletionItem[] } | null;

export interface HoverResult {
  contents:
    | string
    | { kind?: string; value: string }
    | Array<string | { language?: string; value: string }>;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LspLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export type LspFeature =
  | "completion"
  | "hover"
  | "definition"
  | "references"
  | "documentSymbols"
  | "rename"
  | "formatting"
  | "codeAction";

type StateListener = () => void;

const CAPABILITY_KEYS: Record<LspFeature, string> = {
  completion: "completionProvider",
  hover: "hoverProvider",
  definition: "definitionProvider",
  references: "referencesProvider",
  documentSymbols: "documentSymbolProvider",
  rename: "renameProvider",
  formatting: "documentFormattingProvider",
  codeAction: "codeActionProvider",
};

export function isLanguageConfigured(
  language: string,
  configuration?: { command?: string },
): boolean {
  const normalized = language.toLowerCase();
  if (
    normalized === "typescript" ||
    normalized === "javascript" ||
    normalized === "javascriptreact" ||
    normalized === "typescriptreact" ||
    normalized === "python"
  ) {
    return true;
  }
  return Boolean(configuration?.command && configuration.command.trim().length > 0);
}

export class LspClient {
  private static instance: LspClient | null = null;
  private readonly serverStates = new Map<string, LanguageServerInfo>();
  private readonly documentUris = new Map<string, string>();
  private readonly documentTexts = new Map<string, string>();
  private readonly documentLanguages = new Map<string, string>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly disposers: (() => void)[] = [];
  private requestSequence = 1;
  private listenerGeneration = 0;

  private constructor() {
    this.disposers.push(
      EventBus.on("file:renamed", ({ oldPath }) => {
        const uri = this.documentUris.get(oldPath);
        this.documentUris.delete(oldPath);
        this.documentTexts.delete(oldPath);
        this.documentLanguages.delete(oldPath);
        if (uri) DiagnosticsService.clear(uri);
      }),
      EventBus.on("file:deleted", ({ path }) => {
        const uri = this.documentUris.get(path);
        this.documentUris.delete(path);
        this.documentTexts.delete(path);
        this.documentLanguages.delete(path);
        if (uri) DiagnosticsService.clear(uri);
      }),
      EventBus.on("workspace:root-changed", () => {
        DiagnosticsService.clear();
        this.documentUris.clear();
        this.documentTexts.clear();
        this.documentLanguages.clear();
      }),
    );
    void this.setupListeners();
  }

  public static getInstance(): LspClient {
    if (!LspClient.instance) LspClient.instance = new LspClient();
    return LspClient.instance;
  }

  public static disposeCurrent(): void {
    void LspClient.shutdownCurrent();
  }

  public static async shutdownCurrent(): Promise<void> {
    const current = LspClient.instance;
    LspClient.instance = null;
    await current?.dispose();
  }

  public subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public getStates(): readonly LanguageServerInfo[] {
    return [...this.serverStates.values()];
  }

  public getState(language: string): LanguageServerInfo | undefined {
    return this.serverStates.get(language === "javascript" ? "typescript" : language);
  }

  public supports(language: string, feature: LspFeature): boolean {
    const state = this.getState(language);
    return state?.status === "running" && Boolean(state.capabilities[CAPABILITY_KEYS[feature]]);
  }

  public async refreshStates(): Promise<void> {
    const states = await LanguageServerIPC.status<LanguageServerInfo[]>();
    this.serverStates.clear();
    for (const state of states) this.serverStates.set(state.language, state);
    this.emitState();
  }

  public async startServer(language: string): Promise<void> {
    const { WorkspaceService } = await import("../../Core/WorkspaceService");
    const existing = this.getState(language);
    if (
      existing &&
      ["starting", "initializing", "running", "restarting"].includes(existing.status)
    ) {
      return;
    }
    const workspaceRoot = WorkspaceService.getCurrent().primaryRoot;
    try {
      const { LanguageConfigurationService } = await import(
        "../../Core/LanguageConfigurationService"
      );
      const configuration = await LanguageConfigurationService.resolve(language);
      if (!isLanguageConfigured(language, configuration)) {
        return;
      }
      await LanguageServerIPC.start(language, {
        workspaceRoot,
        command: configuration.command,
        args: configuration.args ?? [],
        env: configuration.env ?? {},
        requestTimeoutMs: configuration.requestTimeout ?? 10_000,
        initializationOptions: configuration.initializationOptions ?? {},
        settings: configuration.settings ?? {},
      });
      await this.refreshStates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("No language server is configured")) {
        return;
      }
      OutputService.append("language-server", message, "error");
      this.serverStates.set(language === "javascript" ? "typescript" : language, {
        language: language === "javascript" ? "typescript" : language,
        status: "failed",
        command: "",
        args: [],
        workspaceRoot,
        capabilities: {},
        positionEncoding: "utf-16",
        startedAtMs: null,
        processId: null,
        restartCount: 0,
        lastError: message,
      });
      this.emitState();
      throw error;
    }
  }

  public async stopServer(language: string): Promise<void> {
    await LanguageServerIPC.stop(language);
    await this.refreshStates();
    this.clearDiagnosticsForLanguage(language);
  }

  public async restartServer(language: string): Promise<void> {
    await LanguageServerIPC.restart(language);
    await this.refreshStates();
    this.clearDiagnosticsForLanguage(language);
    await this.reopenDocuments(language);
  }

  public async didOpen(language: string, path: string, text: string, version = 1): Promise<void> {
    this.documentTexts.set(path, text);
    this.documentLanguages.set(path, language);
    const { LanguageConfigurationService } = await import(
      "../../Core/LanguageConfigurationService"
    );
    const configuration = await LanguageConfigurationService.resolve(language);
    if (!isLanguageConfigured(language, configuration)) {
      return;
    }
    await this.startServer(language);
    await this.resolveFileUri(path);
    await LanguageServerIPC.didOpen(language, path, text, version);
  }

  public async didChange(
    language: string,
    path: string,
    text: string,
    version: number,
    edits?: EditorTextEdit[],
  ): Promise<void> {
    const previousText = this.documentTexts.get(path);
    this.documentTexts.set(path, text);
    this.documentLanguages.set(path, language);
    if (this.getState(language)?.status !== "running") return;

    // 增量同步：单条编辑 + 已知修改前文本 + server 协商 incremental 时构造 range 变更，否则整文回退
    const change =
      edits &&
      edits.length === 1 &&
      typeof previousText === "string" &&
      this.serverSyncKind(language) === "incremental"
        ? this.buildIncrementalChange(language, previousText, edits[0])
        : null;
    await LanguageServerIPC.didChange(
      language,
      path,
      text,
      version,
      change ? [change] : undefined,
    );
  }

  /** 服务端声明的 textDocumentSync：incremental / full / 未声明（视为 full，保持既有整文行为） */
  private serverSyncKind(language: string): "full" | "incremental" {
    const sync = this.getState(language)?.capabilities?.textDocumentSync;
    const kind =
      typeof sync === "number"
        ? sync
        : sync && typeof sync === "object"
          ? (sync as { change?: number }).change
          : undefined;
    return typeof kind === "number" && kind >= 2 ? "incremental" : "full";
  }

  /** 单条编辑 → LSP 增量变更（range 基于修改前文本与协商编码）；无法可靠构造时返回 null 走全量 */
  private buildIncrementalChange(
    language: string,
    previousText: string,
    edit: EditorTextEdit,
  ): LspContentChangePayload | null {
    if (edit.startUtf16 < 0 || edit.endUtf16 < edit.startUtf16) return null;
    const encoding = normalizePositionEncoding(this.getState(language)?.positionEncoding);
    const start = utf16OffsetToPosition(previousText, edit.startUtf16);
    const end = utf16OffsetToPosition(previousText, edit.endUtf16);
    if (
      end.line < start.line ||
      (end.line === start.line && end.character < start.character)
    ) {
      return null;
    }
    const startLsp = positionForEncoding(previousText, start, encoding);
    const endLsp = positionForEncoding(previousText, end, encoding);
    const range: { start: LspPosition; end: LspPosition } = { start: startLsp, end: endLsp };
    return { range, text: edit.text };
  }

  public async didSave(language: string, path: string, text?: string): Promise<void> {
    if (this.getState(language)?.status !== "running") return;
    await LanguageServerIPC.didSave(language, path, text);
  }

  public async didClose(language: string, path: string): Promise<void> {
    if (this.getState(language)?.status === "running") {
      await LanguageServerIPC.didClose(language, path);
    }
    this.documentUris.delete(path);
    this.documentTexts.delete(path);
  }

  public async getCompletions(
    language: string,
    path: string,
    line: number,
    character: number,
    requestId = this.nextRequestId(),
    triggerCharacter?: string,
  ): Promise<CompletionResponse> {
    const position = this.encodePosition(language, path, line, character);
    return this.request(
      language,
      "textDocument/completion",
      {
        textDocument: { uri: await this.resolveFileUri(path) },
        position,
        context: triggerCharacter ? { triggerKind: 2, triggerCharacter } : { triggerKind: 1 },
      },
      requestId,
    );
  }

  public async resolveCompletion(language: string, item: CompletionItem): Promise<CompletionItem> {
    return this.request(language, "completionItem/resolve", item);
  }

  public async cancelRequest(language: string, id: number): Promise<void> {
    await LanguageServerIPC.cancel(language, id);
  }

  public async getHoverInfo(
    language: string,
    path: string,
    line: number,
    character: number,
  ): Promise<HoverResult | null> {
    return this.positionRequest(language, path, "textDocument/hover", line, character);
  }

  public async getDefinition(
    language: string,
    path: string,
    line: number,
    character: number,
  ): Promise<unknown> {
    return this.positionRequest(language, path, "textDocument/definition", line, character);
  }

  public async getReferences(
    language: string,
    path: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    return this.positionRequest(language, path, "textDocument/references", line, character, {
      context: { includeDeclaration: true },
    });
  }

  public async getDocumentSymbols(language: string, path: string): Promise<unknown[]> {
    return this.request(language, "textDocument/documentSymbol", {
      textDocument: { uri: await this.resolveFileUri(path) },
    });
  }

  public async prepareRename(
    language: string,
    path: string,
    line: number,
    character: number,
  ): Promise<unknown> {
    return this.positionRequest(language, path, "textDocument/prepareRename", line, character);
  }

  public async rename(
    language: string,
    path: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<unknown> {
    return this.positionRequest(language, path, "textDocument/rename", line, character, {
      newName,
    });
  }

  public async formatDocument(language: string, path: string): Promise<unknown[]> {
    return this.request(language, "textDocument/formatting", {
      textDocument: { uri: await this.resolveFileUri(path) },
      options: { tabSize: 2, insertSpaces: true },
    });
  }

  public async getCodeActions(
    language: string,
    path: string,
    range: unknown,
    diagnostics: readonly DiagnosticItem[],
  ): Promise<unknown[]> {
    return this.request(language, "textDocument/codeAction", {
      textDocument: { uri: await this.resolveFileUri(path) },
      range,
      context: { diagnostics },
    });
  }

  public async resolveCodeAction(language: string, action: unknown): Promise<unknown> {
    return this.request(language, "codeAction/resolve", action);
  }

  public async executeCommand(
    language: string,
    command: string,
    argumentsValue?: unknown[],
  ): Promise<unknown> {
    return this.request(language, "workspace/executeCommand", {
      command,
      arguments: argumentsValue ?? [],
    });
  }

  public getKnownFileUri(path: string): string | undefined {
    return this.documentUris.get(path);
  }

  private async request<Result>(
    language: string,
    method: string,
    params: unknown,
    id?: number,
  ): Promise<Result> {
    if (this.getState(language)?.status !== "running") {
      throw new Error(`Language server for ${language} is not running`);
    }
    return id === undefined
      ? LanguageServerIPC.call<Result>(language, method, params)
      : LanguageServerIPC.callWithId<Result>(language, id, method, params);
  }

  private async positionRequest<Result>(
    language: string,
    path: string,
    method: string,
    line: number,
    character: number,
    extra: Record<string, unknown> = {},
  ): Promise<Result> {
    const position = this.encodePosition(language, path, line, character);
    return this.request(language, method, {
      textDocument: { uri: await this.resolveFileUri(path) },
      position,
      ...extra,
    });
  }

  private encodePosition(
    language: string,
    path: string,
    line: number,
    character: number,
  ): { line: number; character: number } {
    const text = this.documentTexts.get(path) ?? "";
    const encoding = normalizePositionEncoding(this.getState(language)?.positionEncoding);
    return positionForEncoding(text, { line, character }, encoding);
  }

  private async resolveFileUri(path: string): Promise<string> {
    const existing = this.documentUris.get(path);
    if (existing) return existing;
    const uri = await LanguageServerIPC.fileUri(path);
    this.documentUris.set(path, uri);
    return uri;
  }

  private nextRequestId(): number {
    return this.requestSequence++;
  }

  private clearDiagnosticsForLanguage(language: string): void {
    for (const [path, trackedLanguage] of this.documentLanguages) {
      if (trackedLanguage !== language) continue;
      const uri = this.documentUris.get(path);
      if (uri) DiagnosticsService.clear(uri);
    }
  }

  private async reopenDocuments(language: string): Promise<void> {
    for (const [path, trackedLanguage] of this.documentLanguages) {
      if (trackedLanguage !== language) continue;
      const document = DocumentService.get(path);
      const text = document?.content ?? this.documentTexts.get(path) ?? "";
      await LanguageServerIPC.didOpen(language, path, text, document?.version ?? 1);
    }
  }

  private async setupListeners(): Promise<void> {
    const generation = ++this.listenerGeneration;
    const diagnosticsDispose = await LanguageServerIPC.onDiagnostics<DiagnosticsEventPayload>(
      (payload) => {
        if (!payload.params) return;
        DiagnosticsService.update(payload.params);
        EventBus.emit("lsp:diagnostics", payload.params);
      },
    );
    const stateDispose = await LanguageServerIPC.onState<LanguageServerInfo>((state) => {
      this.serverStates.set(state.language, state);
      this.emitState();
    });
    const logDispose = await LanguageServerIPC.onLog<LanguageServerLogPayload>((entry) => {
      const prefix = [entry.language, entry.source].filter(Boolean).join("/");
      OutputService.append(
        "language-server",
        `${prefix ? `[${prefix}] ` : ""}${entry.message}`,
        entry.level ?? "info",
      );
    });
    if (generation !== this.listenerGeneration) {
      diagnosticsDispose();
      stateDispose();
      logDispose();
      return;
    }
    this.disposers.push(diagnosticsDispose, stateDispose, logDispose);
    await this.refreshStates().catch(() => undefined);
  }

  private emitState(): void {
    for (const listener of this.stateListeners) listener();
  }

  private async dispose(): Promise<void> {
    this.listenerGeneration++;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.documentUris.clear();
    this.documentTexts.clear();
    this.serverStates.clear();
    this.emitState();
    await LanguageServerIPC.stopAll().catch((error: unknown) => {
      OutputService.append(
        "language-server",
        `Failed to stop language servers: ${String(error)}`,
        "error",
      );
    });
  }
}
