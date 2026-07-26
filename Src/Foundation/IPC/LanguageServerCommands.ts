import { invokeDesktop, listenDesktop } from "../Desktop";

export interface LanguageServerStartRequest {
  workspaceRoot: string | null;
  command?: string;
  args: string[];
  env: Record<string, string>;
  requestTimeoutMs: number;
  initializationOptions: unknown;
  settings: unknown;
}

export const LanguageServerIPC = {
  fileUri(path: string): Promise<string> {
    return invokeDesktop("lsp_file_uri", { path });
  },

  start(language: string, options: LanguageServerStartRequest): Promise<void> {
    return invokeDesktop("lsp_start", { language, options });
  },

  stop(language: string): Promise<void> {
    return invokeDesktop("lsp_stop", { language });
  },

  restart(language: string): Promise<void> {
    return invokeDesktop("lsp_restart", { language });
  },

  status<Result>(): Promise<Result> {
    return invokeDesktop("lsp_status");
  },

  stopAll(): Promise<void> {
    return invokeDesktop("lsp_stop_all");
  },

  didOpen(language: string, path: string, text: string, version: number): Promise<void> {
    return invokeDesktop("lsp_did_open", { language, path, text, version });
  },

  didChange(language: string, path: string, text: string, version: number): Promise<void> {
    return invokeDesktop("lsp_did_change", { language, path, text, version });
  },

  didSave(language: string, path: string, text?: string): Promise<void> {
    return invokeDesktop("lsp_did_save", { language, path, text });
  },

  didClose(language: string, path: string): Promise<void> {
    return invokeDesktop("lsp_did_close", { language, path });
  },

  call<Result>(language: string, method: string, params: unknown): Promise<Result> {
    return invokeDesktop("lsp_call", { language, method, params });
  },

  callWithId<Result>(
    language: string,
    id: number,
    method: string,
    params: unknown,
  ): Promise<Result> {
    return invokeDesktop("lsp_call_with_id", { language, id, method, params });
  },

  cancel(language: string, id: number): Promise<void> {
    return invokeDesktop("lsp_cancel", { language, id });
  },

  onDiagnostics<Payload>(listener: (payload: Payload) => void): Promise<() => void> {
    return listenDesktop("lsp://diagnostics", listener);
  },

  onState<Payload>(listener: (payload: Payload) => void): Promise<() => void> {
    return listenDesktop("lsp://state", listener);
  },

  onLog<Payload>(listener: (payload: Payload) => void): Promise<() => void> {
    return listenDesktop("lsp://log", listener);
  },
};
