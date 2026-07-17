import { invokeDesktop, listenDesktop } from "../../Foundation/Desktop";
import type { LspDiagnosticsPayload } from "../../Foundation/EventBus";
import { EventBus } from "../../Foundation/EventBus";
import type { CompletionItem } from "./components/AutocompleteMenu";

interface DiagnosticsEventPayload {
  params?: LspDiagnosticsPayload;
}

export type CompletionResponse = CompletionItem[] | { items?: CompletionItem[] } | null;

export interface HoverResult {
  contents: {
    kind?: string;
    value: string;
  };
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export class LspClient {
  private static instance: LspClient | null = null;
  private runningServers = new Set<string>();
  private documentVersions = new Map<string, number>();
  private documentUris = new Map<string, string>();
  private unlistenDiagnostics: (() => void) | null = null;
  private pendingChanges = new Map<string, ReturnType<typeof setTimeout>>();
  private listenerGeneration = 0;

  private constructor() {
    this.setupListeners().catch((e) => console.error("Failed to setup LSP listeners:", e));
  }

  public static getInstance(): LspClient {
    if (!LspClient.instance) {
      LspClient.instance = new LspClient();
    }
    return LspClient.instance;
  }

  public static disposeCurrent(): void {
    const current = LspClient.instance;
    LspClient.instance = null;
    current?.dispose();
  }

  private async setupListeners() {
    const generation = ++this.listenerGeneration;
    if (this.unlistenDiagnostics) {
      this.unlistenDiagnostics();
      this.unlistenDiagnostics = null;
    }
    const unlisten = await listenDesktop<DiagnosticsEventPayload>(
      "lsp://diagnostics",
      (payload) => {
        if (payload.params) EventBus.emit("lsp:diagnostics", payload.params);
      },
    );
    if (generation !== this.listenerGeneration) {
      unlisten();
      return;
    }
    this.unlistenDiagnostics = unlisten;
  }

  private dispose(): void {
    this.listenerGeneration++;
    this.unlistenDiagnostics?.();
    this.unlistenDiagnostics = null;
    for (const timer of this.pendingChanges.values()) window.clearTimeout(timer);
    this.pendingChanges.clear();
    this.documentVersions.clear();
    this.documentUris.clear();
    this.runningServers.clear();
    void invokeDesktop("lsp_stop_all").catch((error) =>
      console.error("Failed to stop LSP servers:", error),
    );
  }

  public async startServer(language: string) {
    if (this.runningServers.has(language)) return;

    try {
      await invokeDesktop("lsp_start", { language });
      this.runningServers.add(language);
    } catch (e) {
      console.error(`Failed to start LSP for ${language}:`, e);
    }
  }

  public async didOpen(language: string, path: string, text: string) {
    if (!this.runningServers.has(language)) return;
    await this.resolveFileUri(path);
    this.documentVersions.set(path, 1);
    try {
      await invokeDesktop("lsp_did_open", { language, path, text, version: 1 });
    } catch (e) {
      console.error(`Failed didOpen for ${path}:`, e);
    }
  }

  public async didChange(language: string, path: string, text: string) {
    if (!this.runningServers.has(language)) return;
    const version = (this.documentVersions.get(path) || 1) + 1;
    this.documentVersions.set(path, version);
    const pending = this.pendingChanges.get(path);
    if (pending) window.clearTimeout(pending);
    const timer = window.setTimeout(() => {
      this.pendingChanges.delete(path);
      invokeDesktop("lsp_did_change", { language, path, text, version }).catch((e) =>
        console.error(`Failed didChange for ${path}:`, e),
      );
    }, 180);
    this.pendingChanges.set(path, timer);
  }

  public async didClose(language: string, path: string) {
    if (!this.runningServers.has(language)) return;
    const pending = this.pendingChanges.get(path);
    if (pending) {
      window.clearTimeout(pending);
      this.pendingChanges.delete(path);
    }
    this.documentVersions.delete(path);
    try {
      await invokeDesktop("lsp_did_close", { language, path });
    } catch (e) {
      console.error(`Failed didClose for ${path}:`, e);
    } finally {
      this.documentUris.delete(path);
    }
  }

  private async resolveFileUri(path: string): Promise<string> {
    const existing = this.documentUris.get(path);
    if (existing) return existing;
    const uri = await invokeDesktop<string>("lsp_file_uri", { path });
    this.documentUris.set(path, uri);
    return uri;
  }

  public getKnownFileUri(path: string): string | undefined {
    return this.documentUris.get(path);
  }

  public async getCompletions(
    language: string,
    path: string,
    line: number,
    character: number,
    reqId?: number,
  ): Promise<CompletionResponse> {
    if (!this.runningServers.has(language)) return null;
    try {
      const params = {
        textDocument: { uri: await this.resolveFileUri(path) },
        position: { line, character },
      };

      if (reqId !== undefined) {
        return await invokeDesktop<CompletionResponse>("lsp_call_with_id", {
          language,
          id: reqId,
          method: "textDocument/completion",
          params,
        });
      }

      return await invokeDesktop<CompletionResponse>("lsp_call", {
        language,
        method: "textDocument/completion",
        params,
      });
    } catch (e) {
      console.error(`Failed getCompletions for ${path}:`, e);
      return null;
    }
  }

  public async cancelRequest(language: string, id: number) {
    if (!this.runningServers.has(language)) return;
    try {
      await invokeDesktop("lsp_cancel", { language, id });
    } catch (e) {
      console.error(`Failed to cancel request ${id} for ${language}:`, e);
    }
  }

  public async getHoverInfo(
    language: string,
    path: string,
    line: number,
    character: number,
  ): Promise<HoverResult | null> {
    if (!this.runningServers.has(language)) return null;
    try {
      return await invokeDesktop<HoverResult | null>("lsp_call", {
        language,
        method: "textDocument/hover",
        params: {
          textDocument: { uri: await this.resolveFileUri(path) },
          position: { line, character },
        },
      });
    } catch (e) {
      console.error(`Failed getHoverInfo for ${path}:`, e);
      return null;
    }
  }

  public async getDefinition(
    language: string,
    path: string,
    line: number,
    character: number,
  ): Promise<unknown> {
    if (!this.runningServers.has(language)) return null;
    try {
      return await invokeDesktop<unknown>("lsp_call", {
        language,
        method: "textDocument/definition",
        params: {
          textDocument: { uri: await this.resolveFileUri(path) },
          position: { line, character },
        },
      });
    } catch (e) {
      console.error(`Failed getDefinition for ${path}:`, e);
      return null;
    }
  }

  public async formatDocument(language: string, path: string): Promise<unknown> {
    if (!this.runningServers.has(language)) return null;
    try {
      return await invokeDesktop<unknown>("lsp_call", {
        language,
        method: "textDocument/formatting",
        params: {
          textDocument: { uri: await this.resolveFileUri(path) },
          options: {
            tabSize: 2,
            insertSpaces: true,
          },
        },
      });
    } catch (e) {
      console.error(`Failed formatDocument for ${path}:`, e);
      return null;
    }
  }
}
