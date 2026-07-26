import { invokeDesktop, listenDesktop } from "../Desktop";

export interface DapLaunchRequest {
  sessionId: string;
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  requestTimeoutMs?: number;
}

export interface DapSessionInfo {
  sessionId: string;
  state: "starting" | "running" | "stopping" | "stopped" | "failed";
  command: string;
  pid?: number;
  lastError?: string;
}

export interface DapEvent {
  sessionId: string;
  event: string;
  body: unknown;
}

export interface DapOutput {
  sessionId: string;
  category: string;
  output: string;
}

export interface PythonDebugpyStatus {
  installed: boolean;
  version?: string;
  message: string;
}

export const DebugAdapterIPC = {
  start(launch: DapLaunchRequest): Promise<DapSessionInfo> {
    return invokeDesktop("dap_start", { launch });
  },
  request<Result>(sessionId: string, command: string, arguments_: unknown): Promise<Result> {
    return invokeDesktop("dap_request", { sessionId, command, arguments: arguments_ });
  },
  status(sessionId: string): Promise<DapSessionInfo | null> {
    return invokeDesktop("dap_status", { sessionId });
  },
  stop(sessionId: string): Promise<void> {
    return invokeDesktop("dap_stop", { sessionId });
  },
  stopAll(): Promise<void> {
    return invokeDesktop("dap_stop_all");
  },
  pythonDebugpyStatus(pythonPath: string): Promise<PythonDebugpyStatus> {
    return invokeDesktop("dap_python_debugpy_status", { pythonPath });
  },
  installPythonDebugpy(pythonPath: string): Promise<PythonDebugpyStatus> {
    return invokeDesktop("dap_install_python_debugpy", { pythonPath });
  },
  onEvent(listener: (event: DapEvent) => void): Promise<() => void> {
    return listenDesktop("dap://event", listener);
  },
  onOutput(listener: (output: DapOutput) => void): Promise<() => void> {
    return listenDesktop("dap://output", listener);
  },
};
