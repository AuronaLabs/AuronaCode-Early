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
  instanceId?: string;
  state: "starting" | "running" | "stopping" | "stopped" | "failed";
  command: string;
  pid?: number;
  lastError?: string;
}

export interface DapEvent {
  sessionId: string;
  instanceId?: string;
  event: string;
  body: unknown;
}

export interface DapOutput {
  sessionId: string;
  instanceId: string;
  seq: number;
  entries: Array<{ category: string; output: string }>;
}

export interface PythonDebugpyStatus {
  installed: boolean;
  version?: string;
  message: string;
}

export const DebugAdapterIPC = {
  async start(launch: DapLaunchRequest): Promise<DapSessionInfo> {
    const launchId = await invokeDesktop<string>("dap_prepare", { launch });
    return invokeDesktop("dap_start", { launchId });
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
  async pythonDebugpyStatus(pythonPath: string): Promise<PythonDebugpyStatus> {
    const launchId = await invokeDesktop<string>("dap_python_prepare", { pythonPath });
    return invokeDesktop("dap_python_debugpy_status", { launchId });
  },
  async installPythonDebugpy(pythonPath: string): Promise<PythonDebugpyStatus> {
    const launchId = await invokeDesktop<string>("dap_python_prepare", { pythonPath });
    return invokeDesktop("dap_install_python_debugpy", { launchId });
  },
  onEvent(listener: (event: DapEvent) => void): Promise<() => void> {
    return listenDesktop("dap://event", listener);
  },
  onOutput(listener: (output: DapOutput) => void): Promise<() => void> {
    return listenDesktop<DapOutput>("dap://output", (output) => {
      try {
        listener(output);
      } finally {
        void invokeDesktop("dap_acknowledge_output", {
          sessionId: output.sessionId,
          instanceId: output.instanceId,
          seq: output.seq,
        }).catch(() => undefined);
      }
    });
  },
};
