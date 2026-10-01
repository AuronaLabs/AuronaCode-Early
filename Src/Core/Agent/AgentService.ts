import { LocaleService } from "../../Foundation/I18n";
import { AiIPC, type AiResponseEventPayload } from "../../Foundation/IPC/AiCommands";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { AiProfile } from "../../Foundation/Types/Config";
import { isAiProfileUsable, resolveAiProfiles } from "../AiProfiles";
import { AgentCheckpointStore } from "./AgentCheckpointStore";
import { AgentSessionStore } from "./AgentSessionStore";
import type {
  AgentEvent,
  AgentEventType,
  AgentProfileSummary,
  AgentSnapshot,
  AgentTaskSnapshot,
  AgentToolExecutor,
  AgentToolOutcome,
} from "./AgentTypes";

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

const MAX_STEPS = 40;

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

function textFromEvent(item: AgentEvent): string {
  return typeof item.payload.content === "string" ? item.payload.content : "";
}

function titleFromInput(input: string): string {
  const compact = input.trim().replace(/\s+/g, " ");
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
}

function inputItem(text: string): Record<string, unknown> {
  return { role: "user", content: [{ type: "input_text", text }] };
}

export function reduceAgentEvent(task: AgentTaskSnapshot, next: AgentEvent): AgentTaskSnapshot {
  const events = [...task.events, next].slice(-500);
  const updated: AgentTaskSnapshot = { ...task, events, updatedAt: next.timestamp };
  switch (next.type) {
    case "task.created":
      updated.input = textFromEvent(next) || updated.input;
      updated.title = updated.title || titleFromInput(updated.input);
      updated.status = "planning";
      break;
    case "task.queued":
      if (typeof next.payload.content === "string") {
        updated.queuedInputs = [...updated.queuedInputs, next.payload.content].slice(0, 20);
      }
      if (updated.status === "idle") updated.status = "queued";
      break;
    case "task.paused":
      updated.status = "paused";
      break;
    case "task.resumed":
      updated.status = "running";
      break;
    case "task.steered":
      updated.status = "running";
      break;
    case "task.completed":
      updated.status = "completed";
      break;
    case "task.failed":
      updated.status = "failed";
      updated.lastError =
        typeof next.payload.message === "string" ? next.payload.message : "Agent failed";
      break;
    case "task.aborted":
      updated.status = "aborted";
      break;
    case "step.started":
      updated.status = "running";
      updated.steps = [
        ...updated.steps,
        {
          id: next.stepId ?? createId("step"),
          title: typeof next.payload.title === "string" ? next.payload.title : "Agent step",
          kind: (next.payload.kind === "tool" ? "tool" : "model") as "tool" | "model",
          status: "running" as const,
          toolName: typeof next.payload.toolName === "string" ? next.payload.toolName : undefined,
          startedAt: next.timestamp,
        },
      ].slice(-MAX_STEPS);
      break;
    case "step.delta": {
      const step = updated.steps.find((item) => item.id === next.stepId);
      if (step && typeof next.payload.content === "string") {
        step.detail = `${step.detail ?? ""}${next.payload.content}`;
      }
      break;
    }
    case "step.completed": {
      const step = updated.steps.find((item) => item.id === next.stepId);
      if (step) {
        step.status = "completed";
        step.completedAt = next.timestamp;
        if (typeof next.payload.content === "string") step.detail = next.payload.content;
      }
      break;
    }
    case "tool.started": {
      const step = updated.steps.find((item) => item.id === next.stepId);
      if (step) step.status = "running";
      break;
    }
    case "tool.completed": {
      const step = updated.steps.find((item) => item.id === next.stepId);
      if (step) {
        step.status = next.payload.isError === true ? "failed" : "completed";
        step.completedAt = next.timestamp;
        step.detail = typeof next.payload.content === "string" ? next.payload.content : step.detail;
      }
      break;
    }
    case "approval.requested":
      updated.status = "waiting_approval";
      updated.pendingApproval = next.payload.approval as AgentTaskSnapshot["pendingApproval"];
      break;
    case "approval.approved":
    case "approval.rejected":
    case "approval.cancelled":
      updated.pendingApproval = null;
      if (updated.status === "waiting_approval") updated.status = "running";
      break;
    case "checkpoint.created":
      updated.activeCheckpointId =
        typeof next.payload.checkpointId === "string" ? next.payload.checkpointId : null;
      break;
    case "checkpoint.restored":
      updated.activeCheckpointId =
        typeof next.payload.checkpointId === "string"
          ? next.payload.checkpointId
          : updated.activeCheckpointId;
      break;
    default:
      break;
  }
  return updated;
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
    const config = await UserConfigStore.get();
    const resolved = resolveAiProfiles(config.ai);
    this.profiles = resolved.profiles;
    this.activeProfile = resolved.active;
    this.configured = Boolean(
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
    const task = this.store.createTask();
    this.publish();
    return task.id;
  }

  async switchSession(id: string): Promise<void> {
    if (id === this.activeTaskId()) return;
    this.abortTask(this.activeTaskId(), "aborted");
    this.store.setActiveTask(id);
    this.publish();
  }

  deleteSession(id: string): void {
    this.abortTask(id, "aborted");
    this.checkpoints.deleteForTask(id);
    this.store.deleteTask(id);
    this.publish();
  }

  async clear(): Promise<void> {
    const task = this.activeTask();
    this.abortTask(task.id, "aborted");
    this.store.updateTask(task.id, (current) => ({
      ...current,
      events: [],
      steps: [],
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
    const task = this.activeTask();
    if (this.isBusy(task.status)) {
      this.append(task.id, "task.queued", { content: input });
      this.publish();
      return;
    }
    this.append(task.id, "task.created", { content: input });
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
    await this.checkpoints.restore(checkpointId);
    this.append(task.id, "checkpoint.restored", { checkpointId });
    this.publish();
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
    return {
      sessions: this.store.getState().tasks.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        updatedAt: item.updatedAt,
        eventCount: item.events.length,
      })),
      activeTaskId: task.id,
      activeTask: task,
      configured: this.configured,
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
    const next = event(taskId, current.events.length + 1, type, payload, stepId);
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
    if (next) {
      this.store.updateTask(taskId, (current) => ({
        ...current,
        queuedInputs: current.queuedInputs.slice(1),
      }));
    }
    return next;
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
      input: [inputItem(initialInput)],
    };
    this.runtimes.set(taskId, runtime);
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
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        instructions: `${SYSTEM_INSTRUCTIONS}\n\nAvailable tools:\n${this.executor?.toolPrompt ?? "No tools are currently available."}`,
        input: runtime.input,
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
    if (payload.type === "response.output_text.delta") {
      runtime.responseText += payload.delta ?? "";
      if (stepId) this.append(taskId, "step.delta", { content: payload.delta ?? "" }, stepId);
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
    if (payload.type === "response.output_item.done") {
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
    if (payload.type === "error" || payload.type === "response.failed") {
      this.append(taskId, "task.failed", {
        message: payload.message ?? "Responses request failed",
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
    for (const call of calls) {
      if (runtime.controller.signal.aborted) return;
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
      if (checkpoint)
        this.append(
          taskId,
          "checkpoint.created",
          { checkpointId: checkpoint.id, reason: `Before ${call.name}` },
          toolStepId,
        );
      this.append(taskId, "tool.started", { name: call.name }, toolStepId);
      let outcome: AgentToolOutcome;
      if (!this.executor) {
        outcome = { content: "No Agent tools are registered", isError: true };
      } else {
        outcome = await this.executor.execute({
          id: call.id,
          taskId,
          stepId: toolStepId,
          name: call.name,
          arguments: call.arguments,
          signal: runtime.controller.signal,
        });
      }
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
      runtime.input.push({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
      });
      runtime.input.push({
        type: "function_call_output",
        call_id: call.id,
        output: outcome.content,
      });
    }
    runtime.calls.clear();
    runtime.responseText = "";
    await this.sendResponse(taskId, runtime, createId("step"));
  }

  private async createCheckpointForCall(taskId: string, call: RuntimeCall) {
    const name = call.name.trim().split(/[.:/]/).pop();
    if (name !== "edit_file") return null;
    try {
      const args = JSON.parse(call.arguments) as { path?: string };
      if (!args.path) return null;
      return await this.checkpoints.capture(taskId, [args.path], `Before ${call.name}`);
    } catch {
      return null;
    }
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
