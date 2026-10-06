import { LocaleService } from "../../Foundation/I18n";
import { AiIPC, type AiResponseEventPayload } from "../../Foundation/IPC/AiCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { AiProfile } from "../../Foundation/Types/Config";
import { isAiProfileUsable, resolveAiProfiles } from "../AiProfiles";
import { EditorAdapter } from "../Editor/EditorAdapter";
import { WorkspaceService } from "../WorkspaceService";
import { AgentCheckpointStore } from "./AgentCheckpointStore";
import { boundAgentContext } from "./AgentContextBudget";
import { reduceAgentEvent, validEventSeq } from "./AgentEventReducer";
import { AgentSessionStore } from "./AgentSessionStore";
import { scheduleAgentTools } from "./AgentToolScheduler";
import type {
  AgentEvent,
  AgentEventType,
  AgentProfileSummary,
  AgentSnapshot,
  AgentTaskSnapshot,
  AgentToolExecutor,
  AgentToolMetadata,
  AgentToolOutcome,
} from "./AgentTypes";

export { reduceAgentEvent, replayAgentTask } from "./AgentEventReducer";

const SYSTEM_INSTRUCTIONS = [
  "You are Aurona Agent, a careful coding assistant inside Aurona Code.",
  "Reply in the user's language. Keep the response focused and explain decisions briefly.",
  "Use CommonMark Markdown for normal responses. GFM tables, task lists, strikethrough, links, and fenced code blocks are supported; always add a language tag to code fences when known.",
  "LaTeX math is supported: use $...$ for inline math and $$...$$ for display math. Do not output raw HTML, raw tool JSON, SSE events, or large internal logs. The UI renders tool calls as compact status lines, so explain only results useful to the user.",
  "First understand the request, then inspect the workspace with read_file, list_dir, search_workspace, or editor_context. Do not guess file contents or paths.",
  "Before editing, read the relevant file and verify the exact text. Use edit_file for one unique replacement at a time. Relative paths are resolved from the workspace root.",
  "Use get_diagnostics after a meaningful edit when it can validate the result. Use run_command only for registered editor or workbench commands.",
  "Tool arguments must match their JSON schema. If a tool returns an error, explain the cause, correct the arguments, and do not repeat the same failed call.",
  "Write actions and commands require user approval. Stop when approval is rejected, the request is ambiguous, or the workspace has changed unexpectedly.",
  "Use get_tool_help when you need a tool's exact parameters or an example. Never invent a tool name.",
  "When finished, summarize the changes and the checks you actually ran. Do not narrate every token or internal step.",
].join("\n");

const KNOWN_RESPONSE_EVENT_TYPES = new Set([
  "response.created",
  "response.in_progress",
  "response.output_text.delta",
  "response.output_text.done",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.output_item.added",
  "response.output_item.done",
  "response.completed",
  "response.incomplete",
  "response.failed",
  "error",
]);

type AgentListener = () => void;

interface RuntimeCall {
  id: string;
  name: string;
  arguments: string;
}

interface RuntimeTask {
  controller: AbortController;
  requestId: string | null;
  responseId?: string;
  responseText: string;
  calls: Map<string, RuntimeCall>;
  input: unknown[];
}

function createId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function event(
  taskId: string,
  seq: number,
  type: AgentEventType,
  payload: Record<string, unknown>,
  stepId?: string,
): AgentEvent {
  return { id: createId("event"), taskId, seq, timestamp: Date.now(), type, payload, stepId };
}

function inputItem(text: string): Record<string, unknown> {
  return { role: "user", content: [{ type: "input_text", text }] };
}

class AgentServiceImpl {
  private readonly store = new AgentSessionStore();
  private readonly checkpoints = new AgentCheckpointStore();
  private readonly listeners = new Set<AgentListener>();
  private readonly runtimes = new Map<string, RuntimeTask>();
  private executor: AgentToolExecutor | null = null;
  private profiles: AiProfile[] = [];
  private activeProfile: AiProfile | null = null;
  private configured = false;
  private cardEnabled = true;
  private snapshot: AgentSnapshot;
  private responseEventsBound = false;
  private recoveryPending = false;
  private approvalListener:
    | ((payload: {
        taskId: string;
        stepId: string;
        state: "requested" | "approved" | "rejected" | "cancelled";
        toolName: string;
        summary: string;
        args: string;
      }) => void)
    | null = null;

  constructor() {
    const task = this.activeTask();
    this.snapshot = this.buildSnapshot(task);
    void this.bindResponseEvents();
  }

  subscribe = (listener: AgentListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AgentSnapshot => this.snapshot;

  setApprovalListener(listener: typeof this.approvalListener): void {
    this.approvalListener = listener;
  }

  notifyApproval(payload: {
    taskId: string;
    stepId: string;
    state: "requested" | "approved" | "rejected" | "cancelled";
    toolName: string;
    summary: string;
    args: string;
  }): void {
    this.approvalListener?.(payload);
    const task = this.store.getState().tasks.find((item) => item.id === payload.taskId);
    if (!task) return;
    if (payload.state === "requested") {
      if (task.pendingApproval?.stepId === payload.stepId) return;
      const approval = {
        id: createId("approval"),
        taskId: payload.taskId,
        stepId: payload.stepId,
        toolName: payload.toolName,
        summary: payload.summary,
        args: payload.args,
        createdAt: Date.now(),
      };
      this.append(payload.taskId, "approval.requested", { approval }, payload.stepId);
    } else if (payload.state !== "cancelled" || task.pendingApproval) {
      this.append(
        payload.taskId,
        `approval.${payload.state}` as AgentEventType,
        { toolName: payload.toolName },
        payload.stepId,
      );
    }
    this.publish();
  }

  setExecutor(executor: AgentToolExecutor | null): void {
    this.executor = executor;
    this.publish();
  }

  async refreshConfig(): Promise<void> {
    try {
      await this.store.initialize();
      await this.checkpoints.initialize();
      this.recoveryPending = await this.checkpoints.hasPendingRestore();
    } catch (error) {
      this.configured = false;
      this.append(this.activeTaskId(), "task.failed", { message: String(error) });
      this.publish();
      return;
    }
    const config = await UserConfigStore.get();
    const resolved = resolveAiProfiles(config.ai);
    this.profiles = resolved.profiles;
    this.activeProfile = resolved.active;
    this.configured = Boolean(
      !this.recoveryPending &&
        config.ai?.enabled !== false &&
        config.ai?.agentEnabled !== false &&
        isAiProfileUsable(this.activeProfile) &&
        this.activeProfile?.protocol === "responses",
    );
    this.cardEnabled = config.ai?.enabled !== false;
    this.publish();
  }

  async setActiveProfile(id: string): Promise<void> {
    const profile = this.profiles.find((item) => item.id === id);
    if (!profile) return;
    const config = await UserConfigStore.get();
    await UserConfigStore.set({ ai: { ...config.ai, activeProfileId: id } });
    this.activeProfile = profile;
    this.configured = isAiProfileUsable(profile) && profile.protocol === "responses";
    this.publish();
  }

  newSession(): string {
    this.abortTask(this.activeTaskId(), "aborted");
    const task = this.store.createSession();
    this.publish();
    return task.id;
  }

  async switchSession(id: string): Promise<void> {
    const target = this.store.getState().sessions.find((session) => session.id === id);
    const taskId = target?.activeTaskId ?? id;
    if (taskId === this.activeTaskId()) return;
    this.abortTask(this.activeTaskId(), "aborted");
    if (target) this.store.setActiveSession(id);
    else this.store.setActiveTask(id);
    this.publish();
  }

  async deleteSession(id: string): Promise<void> {
    const session = this.store.getState().sessions.find((item) => item.id === id);
    const taskIds = session?.taskIds ?? [id];
    for (const taskId of taskIds) {
      this.abortTask(taskId, "aborted");
      await this.checkpoints.deleteForTask(taskId);
    }
    this.store.deleteSession(id);
    this.publish();
  }

  async clear(): Promise<void> {
    const task = this.activeTask();
    this.abortTask(task.id, "aborted");
    this.store.updateTask(task.id, (current) => ({
      ...current,
      events: [],
      // Keep the sequence watermark when the visible event history is cleared. New events must
      // never reuse ids from a previous run of this task.
      steps: [],
      replayBase: undefined,
      input: "",
      title: "",
      queuedInputs: [],
      pendingApproval: null,
      status: "idle",
      lastError: null,
    }));
    this.publish();
  }

  async send(text: string): Promise<void> {
    const input = text.trim();
    if (!input) return;
    const current = this.activeTask();
    if (this.isBusy(current.status)) {
      this.append(current.id, "task.queued", { content: input });
      this.publish();
      return;
    }
    // A Session is the user's conversation context and a Task owns the full
    // execution thread. Follow-up instructions stay on that Task; explicit
    // task creation remains available through the SessionStore API.
    const task = current;
    this.append(
      task.id,
      task.events.length === 0 && task.status === "idle" ? "task.created" : "task.steered",
      { content: input },
    );
    this.publish();
    await this.run(task.id, input);
  }

  async steer(text: string): Promise<void> {
    const input = text.trim();
    if (!input) return;
    const task = this.activeTask();
    this.append(task.id, "task.steered", { content: input });
    this.append(task.id, "task.queued", { content: input });
    const runtime = this.runtimes.get(task.id);
    if (runtime) {
      runtime.controller.abort();
      if (runtime.requestId) void AiIPC.responsesAbort(runtime.requestId);
      this.runtimes.delete(task.id);
    }
    this.publish();
    const queued = this.dequeueInput(task.id);
    if (queued) await this.run(task.id, queued);
  }

  async resume(): Promise<void> {
    const task = this.activeTask();
    const queued = this.dequeueInput(task.id) ?? task.input;
    if (!queued) return;
    this.append(task.id, "task.resumed", {});
    await this.run(task.id, queued);
  }

  async abort(): Promise<void> {
    this.abortTask(this.activeTaskId(), "aborted");
    this.publish();
  }

  async retry(): Promise<void> {
    const task = this.activeTask();
    if (!task.input) return;
    this.append(task.id, "task.resumed", {});
    await this.run(task.id, task.input);
  }

  async restoreCheckpoint(checkpointId: string): Promise<void> {
    const task = this.activeTask();
    for (const taskId of this.runtimes.keys()) this.abortTask(taskId, "aborted");
    await this.checkpoints.restore(checkpointId);
    this.append(task.id, "checkpoint.restored", { checkpointId });
    this.publish();
  }

  async recoverPendingRestore(): Promise<void> {
    for (const taskId of this.runtimes.keys()) this.abortTask(taskId, "aborted");
    try {
      await this.checkpoints.recoverPendingRestore();
      await this.refreshConfig();
    } catch (error) {
      this.append(this.activeTaskId(), "task.failed", { message: String(error) });
      this.publish();
    }
  }

  private activeTaskId(): string {
    return this.store.getState().activeTaskId;
  }

  private activeTask(): AgentTaskSnapshot {
    const task = this.store.getState().tasks.find((item) => item.id === this.activeTaskId());
    if (task) return task;
    return this.store.createTask();
  }

  private isBusy(status: AgentTaskSnapshot["status"]): boolean {
    return status === "planning" || status === "running" || status === "waiting_approval";
  }

  private buildSnapshot(task: AgentTaskSnapshot): AgentSnapshot {
    const state = this.store.getState();
    const taskMeta = (item: AgentTaskSnapshot) => ({
      id: item.id,
      sessionId: item.sessionId ?? "",
      parentTaskId: item.parentTaskId,
      title: item.title,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      eventCount: item.events.length,
    });
    return {
      sessions: state.sessions.map((session) => {
        const sessionTasks = session.taskIds
          .map((id) => state.tasks.find((item) => item.id === id))
          .filter((item): item is AgentTaskSnapshot => Boolean(item));
        const active =
          sessionTasks.find((item) => item.id === session.activeTaskId) ?? sessionTasks[0];
        return {
          id: session.id,
          title: session.title || active?.title || "",
          createdAt: session.createdAt,
          status: active?.status ?? "idle",
          updatedAt: session.updatedAt,
          eventCount: sessionTasks.reduce((count, item) => count + item.events.length, 0),
          activeTaskId: session.activeTaskId,
          taskCount: sessionTasks.length,
          tasks: sessionTasks.map(taskMeta),
        };
      }),
      session: state.sessions.find((item) => item.id === state.activeSessionId),
      sessionTasks: (
        state.sessions.find((item) => item.id === state.activeSessionId)?.taskIds ?? []
      )
        .map((id) => state.tasks.find((item) => item.id === id))
        .filter((item): item is AgentTaskSnapshot => Boolean(item)),
      taskHistory: state.tasks.map(taskMeta),
      activeTaskId: task.id,
      activeTask: task,
      configured: this.configured,
      recoveryPending: this.recoveryPending,
      cardEnabled: this.cardEnabled,
      profiles: this.profiles.map<AgentProfileSummary>((profile) => ({
        id: profile.id,
        name: profile.name,
        model: profile.model,
        protocol: "responses",
      })),
      activeProfileId: this.activeProfile?.id ?? null,
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot(this.activeTask());
    for (const listener of this.listeners) listener();
  }

  private append(
    taskId: string,
    type: AgentEventType,
    payload: Record<string, unknown>,
    stepId?: string,
  ): AgentEvent {
    const current = this.store.getState().tasks.find((item) => item.id === taskId);
    if (!current) throw new Error("Agent task not found");
    const lastEventSeq = Math.max(
      validEventSeq(current.lastEventSeq),
      ...current.events.map((item) => validEventSeq(item.seq)),
    );
    const next = event(taskId, lastEventSeq + 1, type, payload, stepId);
    this.store.updateTask(taskId, (task) => reduceAgentEvent(task, next));
    return next;
  }

  private abortTask(taskId: string, reason: "aborted" | "paused"): void {
    const task = this.store.getState().tasks.find((item) => item.id === taskId);
    if (!task) return;
    const runtime = this.runtimes.get(taskId);
    const hadWork = Boolean(runtime) || this.isBusy(task.status) || task.pendingApproval !== null;
    if (!hadWork) return;
    runtime?.controller.abort();
    if (runtime?.requestId) void AiIPC.responsesAbort(runtime.requestId);
    if (task.pendingApproval) {
      this.append(
        taskId,
        "approval.cancelled",
        { approvalId: task.pendingApproval.id },
        task.pendingApproval.stepId,
      );
      this.approvalListener?.({
        taskId,
        stepId: task.pendingApproval.stepId,
        state: "cancelled",
        toolName: task.pendingApproval.toolName,
        summary: task.pendingApproval.summary,
        args: task.pendingApproval.args,
      });
    }
    this.runtimes.delete(taskId);
    this.append(taskId, reason === "paused" ? "task.paused" : "task.aborted", {});
  }

  private dequeueInput(taskId: string): string | null {
    const task = this.store.getState().tasks.find((item) => item.id === taskId);
    const next = task?.queuedInputs[0] ?? null;
    if (next) this.append(taskId, "task.input_consumed", { content: next });
    return next;
  }

  private buildRuntimeInput(taskId: string, initialInput: string): unknown[] {
    const state = this.store.getState();
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return [inputItem(initialInput)];
    const session = state.sessions.find((item) => item.id === task.sessionId);
    const tasks = (session?.taskIds ?? [taskId])
      .map((id) => state.tasks.find((item) => item.id === id))
      .filter((item): item is AgentTaskSnapshot => Boolean(item))
      .sort((a, b) => a.createdAt - b.createdAt);
    const input: unknown[] = [];
    for (const current of tasks) {
      for (const item of [...current.events].sort((a, b) => a.seq - b.seq)) {
        if (
          (item.type === "task.created" || item.type === "task.steered") &&
          typeof item.payload.content === "string" &&
          item.payload.content.trim()
        ) {
          input.push(inputItem(item.payload.content));
        } else if (
          item.type === "step.completed" &&
          typeof item.payload.content === "string" &&
          item.payload.content.trim()
        ) {
          input.push({
            role: "assistant",
            content: [{ type: "output_text", text: item.payload.content }],
          });
        }
      }
    }
    const currentInput = inputItem(initialInput);
    if (JSON.stringify(input.at(-1)) !== JSON.stringify(currentInput)) input.push(currentInput);
    return boundAgentContext(input);
  }

  private async bindResponseEvents(): Promise<void> {
    if (this.responseEventsBound) return;
    this.responseEventsBound = true;
    await AiIPC.onResponseEvent((payload) => this.handleResponseEvent(payload));
  }

  private async run(taskId: string, initialInput: string): Promise<void> {
    if (!this.configured || !this.activeProfile) {
      this.append(taskId, "task.failed", { message: LocaleService.translate("ai.errorConnect") });
      this.publish();
      return;
    }
    const task = this.store.getState().tasks.find((item) => item.id === taskId);
    if (!task) return;
    const runtime: RuntimeTask = {
      controller: new AbortController(),
      requestId: null,
      responseText: "",
      calls: new Map(),
      input: [],
    };
    this.runtimes.set(taskId, runtime);
    try {
      runtime.input = this.buildRuntimeInput(taskId, initialInput);
    } catch (error) {
      this.runtimes.delete(taskId);
      this.append(taskId, "task.failed", { message: String(error) });
      this.publish();
      return;
    }
    const stepId = createId("step");
    this.append(taskId, "step.started", { title: "Plan and execute task", kind: "model" }, stepId);
    await this.sendResponse(taskId, runtime, stepId);
  }

  private async sendResponse(taskId: string, runtime: RuntimeTask, stepId: string): Promise<void> {
    if (runtime.controller.signal.aborted) return;
    const profile = this.activeProfile;
    if (!profile) return;
    const current = this.store.getState().tasks.find((item) => item.id === taskId);
    if (current && !current.steps.some((step) => step.id === stepId)) {
      this.append(taskId, "step.started", { title: "Agent response", kind: "model" }, stepId);
    }
    const requestId = createId("request");
    runtime.requestId = requestId;
    try {
      await AiIPC.responsesSend({
        requestId,
        profileId: profile.id,
        instructions: `${SYSTEM_INSTRUCTIONS}\n\nAvailable tools:\n${this.executor?.toolPrompt ?? "No tools are currently available."}`,
        input: boundAgentContext(runtime.input),
        tools: this.executor?.definitions,
        // Keep each continuation self-contained. Some Responses-compatible gateways reject
        // previous_response_id even though they accept the standard streaming protocol.
      });
    } catch (error) {
      if (runtime.controller.signal.aborted) return;
      this.runtimes.delete(taskId);
      this.append(taskId, "task.failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      this.publish();
      return;
    }
    if (runtime.controller.signal.aborted) return;
    this.publish();
  }

  private async handleResponseEvent(payload: AiResponseEventPayload): Promise<void> {
    const target = [...this.runtimes.entries()].find(
      ([, runtime]) => runtime.requestId === payload.requestId,
    );
    if (!target) return;
    const [taskId, runtime] = target;
    const task = this.store.getState().tasks.find((item) => item.id === taskId);
    if (!task || runtime.controller.signal.aborted) return;
    const stepId = [...task.steps]
      .reverse()
      .find((step) => step.kind === "model" && step.status === "running")?.id;
    if (payload.responseId) runtime.responseId = payload.responseId;
    if (!KNOWN_RESPONSE_EVENT_TYPES.has(payload.type)) {
      // Gateways can add event kinds before this client learns about them. Keep
      // the raw payload in the event log so replay/debugging does not lose data.
      this.append(taskId, "response.event", {
        eventType: payload.type,
        rawEvent: payload.rawEvent ?? payload.raw ?? payload,
      });
      this.publish();
      return;
    }
    if (payload.type === "response.created" || payload.type === "response.in_progress") {
      this.publish();
      return;
    }
    if (payload.type === "response.output_text.delta") {
      runtime.responseText += payload.delta ?? "";
      if (stepId) this.append(taskId, "step.delta", { content: payload.delta ?? "" }, stepId);
      this.publish();
      return;
    }
    if (payload.type === "response.output_text.done") {
      if (typeof payload.text === "string" && !runtime.responseText.endsWith(payload.text)) {
        runtime.responseText += payload.text;
        if (stepId) this.append(taskId, "step.delta", { content: payload.text }, stepId);
      }
      this.publish();
      return;
    }
    if (payload.type === "response.function_call_arguments.delta") {
      const id = payload.callId ?? `call-${payload.outputIndex ?? 0}`;
      const existing = runtime.calls.get(id) ??
        [...runtime.calls.values()].find(
          (call) => !call.name || (Boolean(payload.name) && call.name === payload.name),
        ) ?? { id, name: payload.name ?? "", arguments: "" };
      if (existing.id !== id) runtime.calls.delete(existing.id);
      existing.id = id;
      existing.name = payload.name ?? existing.name;
      existing.arguments += payload.argumentsDelta ?? "";
      runtime.calls.set(id, existing);
      this.publish();
      return;
    }
    if (payload.type === "response.function_call_arguments.done") {
      const id = payload.callId ?? payload.itemId ?? `call-${payload.outputIndex ?? 0}`;
      const existing = runtime.calls.get(id) ??
        [...runtime.calls.values()].find(
          (call) => call.id === `call-${payload.outputIndex ?? -1}` || !call.name,
        ) ?? { id, name: payload.name ?? "", arguments: "" };
      if (existing.id !== id) runtime.calls.delete(existing.id);
      existing.id = id;
      existing.name = payload.name ?? existing.name;
      if (typeof payload.arguments === "string") existing.arguments = payload.arguments;
      runtime.calls.set(id, existing);
      this.publish();
      return;
    }
    if (
      payload.type === "response.output_item.added" ||
      payload.type === "response.output_item.done"
    ) {
      const raw =
        payload.raw && typeof payload.raw === "object"
          ? (payload.raw as Record<string, unknown>)
          : null;
      const item =
        raw?.item && typeof raw.item === "object" ? (raw.item as Record<string, unknown>) : raw;
      if (item?.type === "function_call") {
        const id =
          typeof item.call_id === "string" ? item.call_id : (payload.callId ?? createId("call"));
        const name = typeof item.name === "string" ? item.name : (payload.name ?? "");
        const existing =
          runtime.calls.get(id) ??
          [...runtime.calls.values()].find(
            (call) => !call.name || (Boolean(name) && call.name === name),
          );
        if (existing) {
          if (existing.id !== id) runtime.calls.delete(existing.id);
          existing.id = id;
          existing.name = name || existing.name;
          if (typeof item.arguments === "string") existing.arguments = item.arguments;
          runtime.calls.set(id, existing);
        } else {
          runtime.calls.set(id, {
            id,
            name,
            arguments: typeof item.arguments === "string" ? item.arguments : "",
          });
        }
      }
      return;
    }
    if (
      payload.type === "error" ||
      payload.type === "response.failed" ||
      payload.type === "response.incomplete"
    ) {
      this.append(taskId, "task.failed", {
        message:
          payload.message ??
          (payload.finishReason
            ? `Responses response ${payload.finishReason}`
            : "Responses request failed"),
      });
      this.runtimes.delete(taskId);
      this.publish();
      return;
    }
    if (payload.type !== "response.completed") return;
    runtime.requestId = null;
    const calls = [...runtime.calls.values()].filter((call) => call.name.trim());
    if (calls.length === 0) {
      if (stepId) this.append(taskId, "step.completed", { content: runtime.responseText }, stepId);
      this.finishOrDrain(taskId);
      return;
    }
    if (stepId) this.append(taskId, "step.completed", { content: runtime.responseText }, stepId);
    let outcomes: Array<{ call: RuntimeCall; result: AgentToolOutcome } | null>;
    try {
      outcomes = await scheduleAgentTools(
        calls,
        (call) => this.toolMetadata(call.name),
        (call) => this.executeToolCall(taskId, runtime, call),
        runtime.controller.signal,
      );
    } catch (error) {
      runtime.controller.abort();
      runtime.calls.clear();
      if (this.runtimes.get(taskId) === runtime) {
        this.runtimes.delete(taskId);
        this.append(taskId, "task.failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        this.publish();
      }
      return;
    }
    if (runtime.controller.signal.aborted || outcomes.some((outcome) => outcome === null)) {
      return;
    }
    for (const outcome of outcomes) {
      if (!outcome) continue;
      runtime.input.push({
        type: "function_call",
        call_id: outcome.call.id,
        name: outcome.call.name,
        arguments: outcome.call.arguments,
      });
      runtime.input.push({
        type: "function_call_output",
        call_id: outcome.call.id,
        output: outcome.result.content,
      });
    }
    runtime.calls.clear();
    runtime.responseText = "";
    await this.sendResponse(taskId, runtime, createId("step"));
  }

  private async executeToolCall(
    taskId: string,
    runtime: RuntimeTask,
    call: RuntimeCall,
  ): Promise<{ call: RuntimeCall; result: AgentToolOutcome } | null> {
    if (runtime.controller.signal.aborted) return null;
    const toolStepId = createId("step");
    this.append(
      taskId,
      "tool.requested",
      { name: call.name, arguments: call.arguments },
      toolStepId,
    );
    this.append(
      taskId,
      "step.started",
      { title: call.name, kind: "tool", toolName: call.name },
      toolStepId,
    );
    const checkpoint = await this.createCheckpointForCall(taskId, call);
    try {
      await this.store.flush();
    } catch (error) {
      runtime.controller.abort();
      this.runtimes.delete(taskId);
      this.append(taskId, "task.failed", { message: String(error) });
      this.publish();
      return null;
    }
    if (runtime.controller.signal.aborted) return null;
    if (checkpoint) {
      this.append(
        taskId,
        "checkpoint.created",
        { checkpointId: checkpoint.id, reason: `Before ${call.name}` },
        toolStepId,
      );
    }
    this.append(taskId, "tool.started", { name: call.name }, toolStepId);
    const metadata = this.toolMetadata(call.name);
    let outcome: AgentToolOutcome;
    if (metadata && this.requiresCheckpoint(metadata) && !checkpoint) {
      outcome = {
        content: "Unable to create a checkpoint before this tool call; operation skipped.",
        isError: true,
      };
    } else if (!this.executor) {
      outcome = { content: "No Agent tools are registered", isError: true };
    } else {
      try {
        outcome = await this.executor.execute({
          id: call.id,
          taskId,
          stepId: toolStepId,
          name: call.name,
          arguments: call.arguments,
          signal: runtime.controller.signal,
        });
      } catch (error) {
        if (runtime.controller.signal.aborted) return null;
        outcome = {
          content: error instanceof Error ? error.message : String(error),
          isError: true,
        };
      }
    }
    if (checkpoint) {
      try {
        await this.checkpoints.seal(checkpoint.id);
      } catch (error) {
        outcome = {
          ...outcome,
          isError: true,
          content: `${outcome.content}\nCheckpoint after-state could not be saved: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    if (runtime.controller.signal.aborted) return null;
    this.append(
      taskId,
      "tool.completed",
      {
        name: call.name,
        content: outcome.content,
        isError: outcome.isError,
        affectedFiles: outcome.affectedFiles,
      },
      toolStepId,
    );
    this.append(taskId, "step.completed", { content: outcome.content }, toolStepId);
    return { call, result: outcome };
  }

  private async createCheckpointForCall(taskId: string, call: RuntimeCall) {
    const metadata = this.toolMetadata(call.name);
    if (!metadata || !this.requiresCheckpoint(metadata)) return null;
    try {
      const invocation = {
        id: call.id,
        taskId,
        stepId: "checkpoint",
        name: call.name,
        arguments: call.arguments,
        signal: this.runtimes.get(taskId)?.controller.signal ?? new AbortController().signal,
      };
      const resolved = this.executor?.resolveAffectedFiles
        ? await this.executor.resolveAffectedFiles(invocation)
        : [];
      const args = JSON.parse(call.arguments) as { path?: string };
      const fallback = this.resolveCheckpointPath(args.path) ?? EditorAdapter.getStatus().path;
      const paths = [
        ...new Set(
          resolved
            .map((path) => this.resolveCheckpointPath(path))
            .filter((path): path is string => Boolean(path)),
        ),
      ];
      // A command may run with no editor tab. Keep an empty checkpoint as the
      // durable execution boundary instead of silently disabling the tool.
      return await this.checkpoints.capture(
        taskId,
        paths.length > 0 ? paths : fallback ? [fallback] : [],
        `Before ${call.name}`,
      );
    } catch {
      return null;
    }
  }

  private toolMetadata(name: string): AgentToolMetadata | undefined {
    const normalized = name.trim().split(/[.:/]/).pop() ?? name.trim();
    return (
      this.executor?.getToolMetadata?.(normalized) ??
      this.executor?.metadata?.find((item) => item.name === normalized)
    );
  }

  private requiresCheckpoint(metadata: AgentToolMetadata): boolean {
    if (metadata.checkpointPolicy === "always") return true;
    if (metadata.checkpointPolicy !== "before-write") return false;
    return metadata.effects.some((effect) =>
      ["filesystem.write", "workspace.modify", "workspace.change", "editor.modify"].includes(
        effect,
      ),
    );
  }

  private resolveCheckpointPath(input: string | undefined): string | null {
    const raw = input?.trim() ?? "";
    if (!raw) return null;
    const root = WorkspaceService.getCurrent().primaryRoot;
    if (!root) return null;
    const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
    const candidate = raw.replaceAll("\\", "/");
    const isAbsolute = /^[A-Za-z]:\//.test(candidate) || candidate.startsWith("/");
    const base = isAbsolute ? candidate : `${normalizedRoot}/${candidate}`;
    const rootSegments = normalizedRoot.split("/").filter(Boolean).length;
    const parts = base.split("/");
    const normalized: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (normalized.length <= rootSegments) return null;
        normalized.pop();
      } else {
        normalized.push(part);
      }
    }
    const resolved = (candidate.startsWith("/") ? "/" : "") + normalized.join("/");
    const lowerRoot = normalizedRoot.toLowerCase();
    const lowerResolved = resolved.toLowerCase();
    if (lowerResolved !== lowerRoot && !lowerResolved.startsWith(`${lowerRoot}/`)) return null;
    return resolved;
  }

  private finishOrDrain(taskId: string): void {
    const task = this.store.getState().tasks.find((item) => item.id === taskId);
    if (!task) return;
    const nextInput = this.dequeueInput(taskId);
    if (nextInput) {
      const runtime = this.runtimes.get(taskId);
      if (runtime) {
        runtime.input.push(inputItem(nextInput));
        runtime.responseText = "";
        void this.sendResponse(taskId, runtime, createId("step"));
      } else {
        void this.run(taskId, nextInput);
      }
      this.publish();
      return;
    }
    this.append(taskId, "task.completed", {});
    this.runtimes.delete(taskId);
    this.publish();
  }
}

export const AgentService = new AgentServiceImpl();
