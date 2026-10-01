import type { AgentEvent, AgentReplayBase, AgentTaskSnapshot } from "./AgentTypes";

const MAX_EVENTS = 500;
const MAX_STEPS = 40;

function createId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function textFromEvent(item: AgentEvent): string {
  return typeof item.payload.content === "string" ? item.payload.content : "";
}

function titleFromInput(input: string): string {
  const compact = input.trim().replace(/\s+/g, " ");
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
}

export function validEventSeq(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Apply one persisted Agent event without mutating the input snapshot.
 * This module intentionally has no storage, IPC, or UI dependencies so it can be
 * used both by the runtime and by recovery/event replay.
 */
export function reduceAgentEvent(task: AgentTaskSnapshot, next: AgentEvent): AgentTaskSnapshot {
  const events = [...task.events, next];
  const updated: AgentTaskSnapshot = {
    ...task,
    events: events.slice(-MAX_EVENTS),
    lastEventSeq: Math.max(validEventSeq(task.lastEventSeq), validEventSeq(next.seq)),
    steps: task.steps.map((step) => ({ ...step })),
    queuedInputs: [...task.queuedInputs],
    pendingApproval: task.pendingApproval ? { ...task.pendingApproval } : null,
    updatedAt: next.timestamp,
  };
  switch (next.type) {
    case "task.created":
      updated.input = textFromEvent(next) || updated.input;
      if (updated.input) updated.title = titleFromInput(updated.input);
      updated.metadata = {
        ...updated.metadata,
        title: updated.title,
        input: updated.input,
      };
      updated.status = "planning";
      break;
    case "task.queued":
      if (typeof next.payload.content === "string") {
        updated.queuedInputs = [...updated.queuedInputs, next.payload.content].slice(0, 20);
      }
      if (updated.status === "idle") updated.status = "queued";
      break;
    case "task.input_consumed": {
      const content = typeof next.payload.content === "string" ? next.payload.content : undefined;
      const index = content ? updated.queuedInputs.indexOf(content) : 0;
      if (index >= 0) updated.queuedInputs.splice(index, 1);
      break;
    }
    case "task.paused":
      updated.status = "paused";
      break;
    case "task.resumed":
      updated.status = "running";
      break;
    case "task.steered":
      updated.input = textFromEvent(next) || updated.input;
      updated.metadata = { ...updated.metadata, input: updated.input };
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
      updated.pendingApproval =
        next.payload.approval && typeof next.payload.approval === "object"
          ? { ...(next.payload.approval as NonNullable<AgentTaskSnapshot["pendingApproval"]>) }
          : null;
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
  if (events.length > MAX_EVENTS) {
    const dropped = events.slice(0, events.length - MAX_EVENTS);
    let base = replayBaseSnapshot(task);
    for (const item of dropped) base = reduceAgentEvent(base, item);
    updated.replayBase = toReplayBase(base);
  }
  return updated;
}

function replayBaseSnapshot(task: AgentTaskSnapshot): AgentTaskSnapshot {
  const base = task.replayBase;
  return {
    ...task,
    title: base?.title ?? "",
    input: base?.input ?? "",
    status: base?.status ?? "idle",
    updatedAt: base?.updatedAt ?? task.createdAt,
    events: [],
    lastEventSeq: base?.lastEventSeq ?? 0,
    steps: base?.steps.map((step) => ({ ...step })) ?? [],
    queuedInputs: [...(base?.queuedInputs ?? [])],
    pendingApproval: base?.pendingApproval ? { ...base.pendingApproval } : null,
    activeCheckpointId: base?.activeCheckpointId ?? null,
    lastError: base?.lastError ?? null,
    responseId: base?.responseId,
    metadata: base?.metadata ? { ...base.metadata } : undefined,
    replayBase: undefined,
  };
}

function toReplayBase(task: AgentTaskSnapshot): AgentReplayBase {
  return {
    title: task.title,
    input: task.input,
    status: task.status,
    updatedAt: task.updatedAt,
    steps: task.steps.map((step) => ({ ...step })),
    queuedInputs: [...task.queuedInputs],
    pendingApproval: task.pendingApproval ? { ...task.pendingApproval } : null,
    activeCheckpointId: task.activeCheckpointId,
    lastError: task.lastError,
    responseId: task.responseId,
    metadata: task.metadata ? { ...task.metadata } : undefined,
    lastEventSeq: validEventSeq(task.lastEventSeq),
  };
}

/** Rebuild a task from its event log, retaining only durable metadata as a seed. */
export function replayAgentTask(
  seed: AgentTaskSnapshot,
  events: readonly AgentEvent[] = seed.events,
): AgentTaskSnapshot {
  const base: AgentTaskSnapshot = {
    ...seed,
    // The visible event window is bounded. Seed replay with durable metadata so
    // trimming older task.created events does not erase task identity.
    title:
      typeof seed.replayBase?.title === "string"
        ? seed.replayBase.title
        : typeof seed.metadata?.title === "string"
          ? seed.metadata.title
          : seed.title,
    input:
      typeof seed.replayBase?.input === "string"
        ? seed.replayBase.input
        : typeof seed.metadata?.input === "string"
          ? seed.metadata.input
          : seed.input,
    status: seed.replayBase?.status ?? "idle",
    updatedAt: seed.replayBase?.updatedAt ?? seed.createdAt,
    events: [],
    steps: seed.replayBase?.steps.map((step) => ({ ...step })) ?? [],
    queuedInputs: [...(seed.replayBase?.queuedInputs ?? [])],
    pendingApproval: seed.replayBase?.pendingApproval
      ? { ...seed.replayBase.pendingApproval }
      : null,
    activeCheckpointId: seed.replayBase?.activeCheckpointId ?? null,
    lastError: seed.replayBase?.lastError ?? null,
    responseId: seed.replayBase?.responseId,
    metadata: { ...seed.metadata, ...seed.replayBase?.metadata },
    replayBase: undefined,
  };
  const replayed = [...events]
    .filter((item) => item.taskId === seed.id)
    .sort((a, b) => a.seq - b.seq || a.timestamp - b.timestamp)
    .reduce(reduceAgentEvent, base);
  return {
    ...replayed,
    // A trimmed event log still carries its monotonic watermark in the seed.
    lastEventSeq: Math.max(validEventSeq(seed.lastEventSeq), validEventSeq(replayed.lastEventSeq)),
    createdAt: seed.createdAt,
    sessionId: seed.sessionId,
    parentTaskId: seed.parentTaskId,
    metadata: { ...seed.metadata, ...replayed.metadata },
    replayBase: seed.replayBase,
  };
}
