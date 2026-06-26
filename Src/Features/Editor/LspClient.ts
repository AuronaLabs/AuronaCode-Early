import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EventBus } from "../../Core/EventBus";

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

  private constructor() {
    this.setupListeners().catch(e => console.error("Failed to setup LSP listeners:", e));
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
      // payload looks like: { uri: "file://...", diagnostics: [...] }
      if (event.payload && event.payload.params) {
        EventBus.emit("lsp:diagnostics", event.payload.params);
      }
    });
  }

  public async startServer(language: string) {
    if (this.runningServers.has(language)) return;
    
    let command = "";
    let args: string[] = [];
    
    if (language === "rust") {
      command = "rust-analyzer";
    } else if (language === "typescript" || language === "javascript") {
      command = "cmd.exe";
      args = ["/c", "npx", "typescript-language-server", "--stdio"];
    } else {
      return;
    }

    try {
      await invoke("lsp_start", { language, command, args });
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
    try {
      await invoke("lsp_did_change", { language, path, text, version });
    } catch (e) {
      console.error(`Failed didChange for ${path}:`, e);
    }
  }

  public async didClose(language: string, path: string) {
    if (!this.runningServers.has(language)) return;
    this.documentVersions.delete(path);
    try {
      await invoke("lsp_did_close", { language, path });
    } catch (e) {
      console.error(`Failed didClose for ${path}:`, e);
    }
  }
}
