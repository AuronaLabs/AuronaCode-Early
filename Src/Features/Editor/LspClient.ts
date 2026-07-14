import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EventBus } from "../../Foundation/EventBus";

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
  private static instance: LspClient;
  private runningServers = new Set<string>();
  private documentVersions = new Map<string, number>();
  private unlistenDiagnostics: (() => void) | null = null;
  private pendingChanges = new Map<string, ReturnType<typeof setTimeout>>();

  private constructor() {
    this.setupListeners().catch((e) => console.error("Failed to setup LSP listeners:", e));
  }

  public static getInstance(): LspClient {
    if (!LspClient.instance) {
      LspClient.instance = new LspClient();
    }
    return LspClient.instance;
  }

  private async setupListeners() {
    if (this.unlistenDiagnostics) {
      this.unlistenDiagnostics();
      this.unlistenDiagnostics = null;
    }
    this.unlistenDiagnostics = await listen("lsp://diagnostics", (event: any) => {
      if (event.payload?.params) {
        EventBus.emit("lsp:diagnostics", event.payload.params);
      }
    });
  }

  public async startServer(language: string) {
    if (this.runningServers.has(language)) return;

    try {
      await invoke("lsp_start", { language });
      this.runningServers.add(language);
    } catch (e) {
      console.error(`Failed to start LSP for ${language}:`, e);
    }
  }

  public async didOpen(language: string, path: string, text: string) {
    if (!this.runningServers.has(language)) return;
    this.documentVersions.set(path, 1);
    try {
      await invoke("lsp_did_open", { language, path, text, version: 1 });
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
      invoke("lsp_did_change", { language, path, text, version }).catch((e) =>
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
      await invoke("lsp_did_close", { language, path });
    } catch (e) {
      console.error(`Failed didClose for ${path}:`, e);
    }
  }

  public async getCompletions(
    language: string,
    path: string,
    line: number,
    character: number,
    reqId?: number,
  ): Promise<any> {
    if (!this.runningServers.has(language)) return null;
    try {
      const params = {
        textDocument: { uri: `file:///${path.replace(/\\/g, "/")}` },
        position: { line, character },
      };

      if (reqId !== undefined) {
        return await invoke("lsp_call_with_id", {
          language,
          id: reqId,
          method: "textDocument/completion",
          params,
        });
      }

      return await invoke("lsp_call", {
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
      await invoke("lsp_cancel", { language, id });
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
      return await invoke("lsp_call", {
        language,
        method: "textDocument/hover",
        params: {
          textDocument: { uri: `file:///${path.replace(/\\/g, "/")}` },
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
  ): Promise<any> {
    if (!this.runningServers.has(language)) return null;
    try {
      return await invoke("lsp_call", {
        language,
        method: "textDocument/definition",
        params: {
          textDocument: { uri: `file:///${path.replace(/\\/g, "/")}` },
          position: { line, character },
        },
      });
    } catch (e) {
      console.error(`Failed getDefinition for ${path}:`, e);
      return null;
    }
  }

  public async formatDocument(language: string, path: string): Promise<any> {
    if (!this.runningServers.has(language)) return null;
    try {
      return await invoke("lsp_call", {
        language,
        method: "textDocument/formatting",
        params: {
          textDocument: { uri: `file:///${path.replace(/\\/g, "/")}` },
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
