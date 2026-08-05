import { EventBus } from "../../Foundation/EventBus";
import { LanguageServerIPC } from "../../Foundation/IPC/LanguageServerCommands";
import type { CompletionItem } from "../../Foundation/Types/Lsp";
import { type DiagnosticItem, DiagnosticsService } from "../DiagnosticsService";
import { OutputService } from "../OutputService";
import { normalizePositionEncoding, positionForEncoding } from "./Position";

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

export class LspClient {
  private static instance: LspClient | null = null;
  private readonly serverStates = new Map<string, LanguageServerInfo>();
  private readonly documentUris = new Map<string, string>();
  private readonly documentTexts = new Map<string, string>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly disposers: (() => void)[] = [];
  private requestSequence = 1;
  private listenerGeneration = 0;

  private constructor() {
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
  }

  public async restartServer(language: string): Promise<void> {
    await LanguageServerIPC.restart(language);
    await this.refreshStates();
  }

  public async didOpen(language: string, path: string, text: string, version = 1): Promise<void> {
    this.documentTexts.set(path, text);
    await this.startServer(language);
    await this.resolveFileUri(path);
    await LanguageServerIPC.didOpen(language, path, text, version);
  }

  public async didChange(
    language: string,
    path: string,
    text: string,
    version: number,
  ): Promise<void> {
    this.documentTexts.set(path, text);
    if (this.getState(language)?.status !== "running") return;
    await LanguageServerIPC.didChange(language, path, text, version);
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
