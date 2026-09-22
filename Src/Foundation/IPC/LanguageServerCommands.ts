import { invokeDesktop, listenDesktop } from "../Desktop";

/** LSP 位置（行号 0 基；列按协商编码计） */
export interface LspChangePosition {
  line: number;
  character: number;
}

/** LSP 增量内容变更（range 为修改前文本上的位置；缺省表示整文替换） */
export interface LspContentChangePayload {
  range?: { start: LspChangePosition; end: LspChangePosition };
  text: string;
}

export interface LanguageServerStartRequest {
  workspaceRoot: string | null;
  command?: string;
  args: string[];
  env: Record<string, string>;
  requestTimeoutMs: number;
  initializationOptions: unknown;
  settings: unknown;
}

export interface LanguageToolchainStatus {
  language: string;
  isLspInstalled: boolean;
  installedLspId?: string | null;
  installedLspVersion?: string | null;
  requiredRuntimeType?: string | null;
  isRuntimeReady: boolean;
}

export interface InstalledToolchainSummary {
  id: string;
  name: string;
  version: string;
  languages: string[];
  runtimeType: string;
  installPath: string;
  diskSizeBytes: number;
}

export interface InstalledRuntimeSummary {
  runtimeType: string;
  version: string;
  binaryPath: string;
  diskSizeBytes: number;
}

export interface ToolchainsOverview {
  servers: InstalledToolchainSummary[];
  runtimes: InstalledRuntimeSummary[];
  totalBytes: number;
}

export interface ToolchainDownloadProgress {
  downloadId: string;
  stage: "downloading" | "extracting" | "completed" | "failed";
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
  message?: string;
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

  /** 增量内容变更（range 为修改前文本上的位置；缺省 range 表示整文替换） */
  didChange(
    language: string,
    path: string,
    text: string,
    version: number,
    changes?: LspContentChangePayload[],
  ): Promise<void> {
    return invokeDesktop("lsp_did_change", { language, path, text, version, changes });
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

  toolchainStatus(language: string): Promise<LanguageToolchainStatus> {
    return invokeDesktop("lsp_toolchain_status", { language });
  },

  installToolchain(
    archiveBytes: number[],
    expectedSha256?: string,
  ): Promise<InstalledToolchainSummary> {
    return invokeDesktop("lsp_toolchain_install", { archiveBytes, expectedSha256 });
  },

  installToolchainFromUrl(
    downloadId: string,
    url: string,
    expectedSha256?: string,
  ): Promise<InstalledToolchainSummary> {
    return invokeDesktop("lsp_toolchain_install_url", {
      downloadId,
      url,
      expectedSha256,
    });
  },

  listToolchains(): Promise<ToolchainsOverview> {
    return invokeDesktop("lsp_toolchain_list");
  },

  uninstallToolchain(id: string): Promise<void> {
    return invokeDesktop("lsp_toolchain_uninstall", { id });
  },

  uninstallToolchainRuntime(runtimeType: string): Promise<void> {
    return invokeDesktop("lsp_toolchain_uninstall_runtime", { runtimeType });
  },

  onDownloadProgress(listener: (payload: ToolchainDownloadProgress) => void): Promise<() => void> {
    return listenDesktop("toolchain://download_progress", listener);
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
