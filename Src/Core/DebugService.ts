import { type DapEvent, DebugAdapterIPC } from "../Foundation/IPC/DebugAdapterCommands";
import { UserConfigStore } from "../Foundation/Storage/UserConfigStore";
import {
  type DebugScope,
  type DebugStackFrame,
  type DebugVariable,
  useDebugStore,
} from "../State/useDebugStore";
import { type DebugConfiguration, DebugConfigurationService } from "./DebugConfigurationService";
import { collectVariableValues, diffVariableValues } from "./DebugVariableDiff";
import { OutputService } from "./OutputService";

class DebugServiceImpl {
  private initialized = false;
  private unsubscribe: Array<() => void> = [];
  private startPromise: Promise<void> | null = null;
  private readonly configuredSessions = new Set<string>();

  async initialize(activeFile?: string): Promise<void> {
    if (!this.initialized) {
      this.initialized = true;
      this.unsubscribe.push(
        await DebugAdapterIPC.onEvent((event) => void this.handleEvent(event)),
        await DebugAdapterIPC.onOutput((entry) => {
          OutputService.append(
            "debug-adapter",
            `[${entry.category}] ${entry.output.trimEnd()}`,
            entry.category === "error" || entry.category === "stderr" ? "error" : "info",
          );
        }),
      );
    }
    await this.reloadConfigurations(activeFile);
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    this.initialized = false;
  }

  async reloadConfigurations(activeFile?: string): Promise<void> {
    try {
      const configurations = await DebugConfigurationService.load(activeFile);
      const selected = useDebugStore.getState().selectedConfiguration;
      const selectedConfiguration = configurations.find((item) => item.name === selected);
      const applicableConfiguration = configurations.find(
        (item) => DebugConfigurationService.getApplicability(item, activeFile).supported,
      );
      useDebugStore.getState().set({
        configurations,
        selectedConfiguration:
          (selectedConfiguration &&
          DebugConfigurationService.getApplicability(selectedConfiguration, activeFile).supported
            ? selectedConfiguration.name
            : applicableConfiguration?.name) ??
          configurations[0]?.name ??
          null,
        error: null,
      });
    } catch (error) {
      useDebugStore
        .getState()
        .set({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  async start(configuration: DebugConfiguration, activeFile?: string): Promise<void> {
    if (this.startPromise) return this.startPromise;
    const currentState = useDebugStore.getState().state;
    if (["starting", "running", "paused", "stopping"].includes(currentState)) return;
    this.startPromise = this.startInternal(configuration, activeFile);
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(
    configuration: DebugConfiguration,
    activeFile?: string,
  ): Promise<void> {
    useDebugStore.getState().set({ state: "starting", error: null });
    let resolved: DebugConfiguration;
    try {
      resolved = await DebugConfigurationService.resolveForLaunch(configuration, activeFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useDebugStore.getState().set({ state: "failed", error: message });
      OutputService.append("debug-adapter", message, "error");
      return;
    }
    const preferences = (await UserConfigStore.get()).debug;
    const command =
      resolved.command ??
      (resolved.type === "python"
        ? (preferences?.pythonPath ?? "python")
        : resolved.type === "node"
          ? (preferences?.nodePath ?? "node")
          : undefined);
    const adapterArgs =
      resolved.adapterArgs ?? (resolved.type === "python" ? ["-m", "debugpy.adapter"] : undefined);
    if (!command || !adapterArgs) {
      throw new Error(
        `Debug type "${resolved.type}" needs command and adapterArgs in .aurona/launch.json`,
      );
    }
    if (resolved.type === "python") {
      const available = await this.ensurePythonDebugpy(command);
      if (!available) {
        useDebugStore.getState().set({ state: "idle" });
        return;
      }
    }
    const sessionId = `debug-${Date.now()}`;
    const store = useDebugStore.getState();
    store.set({
      state: "starting",
      sessionId,
      sessionTargetPath: typeof resolved.program === "string" ? resolved.program : null,
      error: null,
      threads: [],
      selectedThreadId: null,
      changedVariables: [],
      stackFrames: [],
      selectedFrameId: null,
      scopes: [],
      variablesByReference: {},
      loadingVariableReferences: [],
      variablePagination: {},
    });
    try {
      await DebugAdapterIPC.start({
        sessionId,
        command,
        args: adapterArgs,
        cwd: resolved.cwd,
        env: resolved.env ?? {},
        requestTimeoutMs: 30_000,
      });
      await DebugAdapterIPC.request(sessionId, "initialize", {
        clientID: "aurona-code",
        clientName: "Aurona Code",
        adapterID: resolved.type,
        pathFormat: "path",
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsRunInTerminalRequest: false,
      });
      await DebugAdapterIPC.request(sessionId, resolved.request, {
        ...this.toAdapterArguments(resolved),
        stopOnEntry: resolved.stopOnEntry ?? preferences?.stopOnEntry ?? false,
      });
      store.set({ state: "running" });
      OutputService.append("debug-adapter", `Started ${resolved.name}`, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.set({ state: "failed", sessionId: null, error: message });
      OutputService.append("debug-adapter", message, "error");
      await DebugAdapterIPC.stop(sessionId);
      this.configuredSessions.delete(sessionId);
    }
  }

  async ensurePythonDebugpy(pythonPath?: string): Promise<boolean> {
    const configuredPath =
      pythonPath ?? (await UserConfigStore.get()).debug?.pythonPath ?? "python";
    const store = useDebugStore.getState();
    store.set({
      dependencyState: "checking",
      dependencyMessage: "正在检查所选 Python 环境…",
      pythonPath: configuredPath,
    });
    try {
      const status = await DebugAdapterIPC.pythonDebugpyStatus(configuredPath);
      store.set({
        dependencyState: status.installed ? "ready" : "missing",
        dependencyMessage: status.message,
        pythonPath: configuredPath,
      });
      return status.installed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.set({
        dependencyState: "failed",
        dependencyMessage: message,
        pythonPath: configuredPath,
      });
      return false;
    }
  }

  async installPythonDebugpy(): Promise<boolean> {
    const store = useDebugStore.getState();
    const pythonPath =
      store.pythonPath ?? (await UserConfigStore.get()).debug?.pythonPath ?? "python";
    store.set({
      dependencyState: "installing",
      dependencyMessage: `正在向 ${pythonPath} 安装 debugpy…`,
      pythonPath,
    });
    OutputService.append("debug-adapter", `正在为 ${pythonPath} 安装 debugpy`, "info");
    try {
      const status = await DebugAdapterIPC.installPythonDebugpy(pythonPath);
      store.set({
        dependencyState: "ready",
        dependencyMessage: status.message,
        error: null,
      });
      OutputService.append("debug-adapter", status.message, "info");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.set({ dependencyState: "failed", dependencyMessage: message });
      OutputService.append("debug-adapter", message, "error");
      return false;
    }
  }

  async stop(): Promise<void> {
    const { sessionId } = useDebugStore.getState();
    if (!sessionId) return;
    useDebugStore.getState().set({ state: "stopping" });
    try {
      await DebugAdapterIPC.request(sessionId, "disconnect", { terminateDebuggee: true });
    } catch {
      // Adapter may already have exited; process cleanup below is authoritative.
    }
    await DebugAdapterIPC.stop(sessionId);
    this.resetSession(sessionId);
  }

  async restart(configuration: DebugConfiguration, activeFile?: string): Promise<void> {
    const { sessionId } = useDebugStore.getState();
    if (sessionId) await this.stop();
    await this.start(configuration, activeFile);
  }

  private resetSession(sessionId: string): void {
    this.configuredSessions.delete(sessionId);
    if (useDebugStore.getState().sessionId !== sessionId) return;
    useDebugStore.getState().set({
      state: "idle",
      sessionId: null,
      sessionTargetPath: null,
      error: null,
      threads: [],
      selectedThreadId: null,
      changedVariables: [],
      stackFrames: [],
      selectedFrameId: null,
      scopes: [],
      variablesByReference: {},
      loadingVariableReferences: [],
      variablePagination: {},
    });
  }

  private async finishSession(sessionId: string): Promise<void> {
    await DebugAdapterIPC.stop(sessionId);
    this.resetSession(sessionId);
    OutputService.append("debug-adapter", "调试会话已结束", "info");
  }

  async request(command: "continue" | "pause" | "next" | "stepIn" | "stepOut"): Promise<void> {
    const { sessionId } = useDebugStore.getState();
    if (!sessionId) return;
    const current = useDebugStore.getState();
    let threads = current.threads;
    let threadId = current.selectedThreadId;
    if (threads.length === 0) {
      const result = await DebugAdapterIPC.request<{
        threads?: Array<{ id: number; name: string }>;
      }>(sessionId, "threads", {});
      threads = result.threads ?? [];
      useDebugStore.getState().set({ threads });
      threadId = threads[0]?.id ?? null;
    } else if (threadId === null) {
      threadId = threads[0]?.id ?? null;
    }
    if (!threadId) throw new Error("Debug Adapter 没有返回可操作的线程");
    await DebugAdapterIPC.request(sessionId, command, { threadId });
  }

  async selectThread(threadId: number): Promise<void> {
    const { sessionId, state } = useDebugStore.getState();
    if (!sessionId || state !== "paused") return;
    useDebugStore.getState().set({
      selectedThreadId: threadId,
      stackFrames: [],
      selectedFrameId: null,
      scopes: [],
      variablesByReference: {},
      loadingVariableReferences: [],
      variablePagination: {},
    });
    const result = await DebugAdapterIPC.request<{ stackFrames?: DebugStackFrame[] }>(
      sessionId,
      "stackTrace",
      { threadId, startFrame: 0, levels: 50 },
    );
    const latest = useDebugStore.getState();
    if (latest.sessionId !== sessionId || latest.selectedThreadId !== threadId) return;
    const stackFrames = result.stackFrames ?? [];
    latest.set({ stackFrames, selectedFrameId: stackFrames[0]?.id ?? null });
    const firstFrame = stackFrames[0];
    if (firstFrame) await this.selectFrame(firstFrame.id);
  }

  async addWatch(expression: string): Promise<void> {
    const trimmed = expression.trim();
    if (!trimmed) return;
    const id = `watch-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    useDebugStore.getState().set({
      watchExpressions: [...useDebugStore.getState().watchExpressions, { id, expression: trimmed }],
    });
    await this.evaluateWatch(id, trimmed);
  }

  removeWatch(id: string): void {
    useDebugStore.getState().set({
      watchExpressions: useDebugStore
        .getState()
        .watchExpressions.filter((entry) => entry.id !== id),
    });
  }

  async updateWatchExpression(id: string, expression: string): Promise<void> {
    const trimmed = expression.trim();
    const current = useDebugStore.getState();
    current.set({
      watchExpressions: current.watchExpressions.map((entry) =>
        entry.id === id ? { ...entry, expression: trimmed } : entry,
      ),
    });
    await this.evaluateWatch(id, trimmed);
  }

  async reevaluateWatches(): Promise<void> {
    for (const entry of useDebugStore.getState().watchExpressions) {
      await this.evaluateWatch(entry.id, entry.expression);
    }
  }

  private async evaluateWatch(id: string, expression: string): Promise<void> {
    const { sessionId, state } = useDebugStore.getState();
    if (!sessionId || state !== "paused") return;
    try {
      const result = await this.evaluate(expression, "watch");
      const latest = useDebugStore.getState();
      if (latest.sessionId !== sessionId) return;
      latest.set({
        watchExpressions: latest.watchExpressions.map((entry) =>
          entry.id === id ? { ...entry, value: result.value, error: undefined } : entry,
        ),
      });
    } catch (error) {
      const latest = useDebugStore.getState();
      if (latest.sessionId !== sessionId) return;
      latest.set({
        watchExpressions: latest.watchExpressions.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                value: undefined,
                error: error instanceof Error ? error.message : String(error),
              }
            : entry,
        ),
      });
    }
  }

  async evaluate(
    expression: string,
    context: "watch" | "repl" | "variables" | "hover" = "repl",
  ): Promise<{ value: string; type?: string }> {
    const { sessionId, state, selectedFrameId, selectedThreadId } = useDebugStore.getState();
    if (!sessionId || state !== "paused") {
      throw new Error("调试会话未暂停，无法求值");
    }
    const result = await DebugAdapterIPC.request<{
      result?: string;
      type?: string;
    }>(sessionId, "evaluate", {
      expression,
      context,
      frameId: selectedFrameId ?? undefined,
      ...(selectedThreadId !== null ? { threadId: selectedThreadId } : {}),
    });
    return { value: result.result ?? "", type: result.type };
  }

  async removeAllBreakpoints(): Promise<void> {
    useDebugStore.getState().removeAllBreakpoints();
    await this.syncBreakpoints();
  }

  async setAllBreakpointsEnabled(enabled: boolean): Promise<void> {
    useDebugStore.getState().setAllBreakpointsEnabled(enabled);
    await this.syncBreakpoints();
  }

  private toAdapterArguments(configuration: DebugConfiguration): Record<string, unknown> {
    const {
      name: _name,
      type: _type,
      request: _request,
      command: _command,
      adapterArgs: _adapterArgs,
      ...arguments_
    } = configuration;
    return arguments_;
  }

  private async handleEvent(event: DapEvent): Promise<void> {
    const store = useDebugStore.getState();
    if (event.sessionId !== store.sessionId) return;
    const body = event.body as Record<string, unknown>;
    if (event.event === "initialized") {
      if (this.configuredSessions.has(event.sessionId)) return;
      this.configuredSessions.add(event.sessionId);
      await this.syncBreakpoints();
      await DebugAdapterIPC.request(event.sessionId, "configurationDone", {});
    } else if (event.event === "stopped") {
      const previousValues = collectVariableValues(store.scopes, store.variablesByReference);
      const threadResult = await DebugAdapterIPC.request<{
        threads?: Array<{ id: number; name: string }>;
      }>(event.sessionId, "threads", {});
      const threads = threadResult.threads ?? [];
      const stoppedThreadId = Number(body.threadId ?? threads[0]?.id);
      store.set({ state: "paused", threads, selectedThreadId: stoppedThreadId || null });
      if (stoppedThreadId) {
        const result = await DebugAdapterIPC.request<{ stackFrames?: DebugStackFrame[] }>(
          event.sessionId,
          "stackTrace",
          { threadId: stoppedThreadId, startFrame: 0, levels: 50 },
        );
        const stackFrames = result.stackFrames ?? [];
        store.set({ stackFrames, selectedFrameId: stackFrames[0]?.id ?? null });
        const firstFrame = stackFrames[0];
        if (firstFrame) {
          await this.selectFrame(firstFrame.id);
        }
        const latest = useDebugStore.getState();
        const currentValues = collectVariableValues(latest.scopes, latest.variablesByReference);
        latest.set({ changedVariables: diffVariableValues(previousValues, currentValues) });
        await this.reevaluateWatches();
      }
    } else if (event.event === "continued") {
      store.set({
        state: "running",
        selectedThreadId: null,
        changedVariables: [],
        stackFrames: [],
        selectedFrameId: null,
        scopes: [],
        variablesByReference: {},
        loadingVariableReferences: [],
        variablePagination: {},
      });
    } else if (event.event === "terminated" || event.event === "exited") {
      await this.finishSession(event.sessionId);
    } else if (event.event === "output") {
      OutputService.append(
        "debug-adapter",
        String(body.output ?? ""),
        body.category === "stderr" ? "error" : "info",
      );
    }
  }

  async selectFrame(frameId: number): Promise<void> {
    const { sessionId, state } = useDebugStore.getState();
    if (!sessionId || state !== "paused") return;
    useDebugStore.getState().set({
      selectedFrameId: frameId,
      scopes: [],
      variablesByReference: {},
      loadingVariableReferences: [],
      variablePagination: {},
    });
    try {
      const result = await DebugAdapterIPC.request<{ scopes?: DebugScope[] }>(sessionId, "scopes", {
        frameId,
      });
      if (
        useDebugStore.getState().sessionId !== sessionId ||
        useDebugStore.getState().selectedFrameId !== frameId
      ) {
        return;
      }
      const scopes = (result.scopes ?? []).filter((scope) => scope.variablesReference > 0);
      useDebugStore.getState().set({ scopes });
      await Promise.all(scopes.map((scope) => this.loadVariables(scope.variablesReference)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      OutputService.append("debug-adapter", `无法读取栈帧变量：${message}`, "error");
    }
  }

  async loadVariables(variablesReference: number, start = 0, totalHint?: number): Promise<void> {
    if (variablesReference <= 0) return;
    const current = useDebugStore.getState();
    if (!current.sessionId || current.loadingVariableReferences.includes(variablesReference)) {
      return;
    }
    const existing = current.variablesByReference[variablesReference] ?? [];
    if (start > 0 && existing.length < start) return;
    const sessionId = current.sessionId;
    const selectedFrameId = current.selectedFrameId;
    current.set({
      loadingVariableReferences: [...current.loadingVariableReferences, variablesReference],
    });
    try {
      const result = await DebugAdapterIPC.request<{ variables?: DebugVariable[] }>(
        sessionId,
        "variables",
        { variablesReference, start, count: 100 },
      );
      const latest = useDebugStore.getState();
      if (latest.sessionId !== sessionId || latest.selectedFrameId !== selectedFrameId) {
        return;
      }
      const incoming = result.variables ?? [];
      const appended = start === 0 ? incoming : [...existing, ...incoming];
      const nextStart = start + incoming.length;
      const hasMore = incoming.length >= 100 && (totalHint === undefined || nextStart < totalHint);
      latest.set({
        variablesByReference: {
          ...latest.variablesByReference,
          [variablesReference]: appended,
        },
        variablePagination: {
          ...latest.variablePagination,
          [variablesReference]: { nextStart, hasMore },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      OutputService.append("debug-adapter", `无法展开变量：${message}`, "error");
    } finally {
      const latest = useDebugStore.getState();
      if (latest.sessionId === sessionId && latest.selectedFrameId === selectedFrameId) {
        latest.set({
          loadingVariableReferences: latest.loadingVariableReferences.filter(
            (reference) => reference !== variablesReference,
          ),
        });
      }
    }
  }

  async syncBreakpoints(): Promise<void> {
    const { sessionId, breakpoints } = useDebugStore.getState();
    if (!sessionId) return;
    const enabled = breakpoints.filter((item) => item.enabled !== false);
    const paths = [...new Set(enabled.map((item) => item.path))];
    const verifiedByKey = new Map<string, { verified?: boolean; message?: string }>();
    const enabledByKey = new Set(enabled.map((item) => `${item.path}:${item.line}`));
    for (const path of paths) {
      const response = await DebugAdapterIPC.request<{
        breakpoints?: Array<{
          line?: number;
          verified?: boolean;
          message?: string;
        }>;
      }>(sessionId, "setBreakpoints", {
        source: { path },
        breakpoints: enabled
          .filter((item) => item.path === path)
          .map((item) => ({
            line: item.line,
            ...(item.condition ? { condition: item.condition } : {}),
            ...(item.hitCondition ? { hitCondition: item.hitCondition } : {}),
            ...(item.logMessage ? { logMessage: item.logMessage } : {}),
          })),
        sourceModified: false,
      });
      for (const item of response.breakpoints ?? []) {
        if (item.line !== undefined) {
          verifiedByKey.set(`${path}:${item.line}`, {
            verified: item.verified,
            message: item.message,
          });
        }
      }
    }
    if (verifiedByKey.size > 0) {
      const latest = useDebugStore.getState();
      if (latest.sessionId !== sessionId) return;
      latest.set({
        breakpoints: latest.breakpoints.map((item) =>
          enabledByKey.has(`${item.path}:${item.line}`)
            ? {
                ...item,
                ...(verifiedByKey.get(`${item.path}:${item.line}`) ?? {}),
              }
            : { ...item, verified: undefined, message: undefined },
        ),
      });
    }
  }
}

export const DebugService = new DebugServiceImpl();

if (import.meta.hot) {
  import.meta.hot.dispose(() => DebugService.dispose());
}
