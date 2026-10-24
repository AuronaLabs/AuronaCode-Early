import { boundAgentContext } from "./AgentContextBudget";
import type { AgentEvent, AgentReplayContext, AgentStepSnapshot } from "./AgentTypes";

export function persistedContextItem(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    item.type === "function_call" &&
    typeof item.call_id === "string" &&
    typeof item.name === "string" &&
    typeof item.arguments === "string"
  ) {
    return { type: item.type, call_id: item.call_id, name: item.name, arguments: item.arguments };
  }
  if (
    item.type === "function_call_output" &&
    typeof item.call_id === "string" &&
    typeof item.output === "string"
  ) {
    return { type: item.type, call_id: item.call_id, output: item.output };
  }
  return null;
}

export function runtimeItemFromEvent(event: AgentEvent, toolStep: boolean): unknown | null {
  if (event.type === "context.item") return persistedContextItem(event.payload.item);
  const text = event.payload.content;
  if (typeof text !== "string" || !text.trim()) return null;
  if (event.type === "task.created" || event.type === "task.steered") {
    return { role: "user", content: [{ type: "input_text", text }] };
  }
  if (event.type === "step.completed" && !toolStep && event.payload.kind !== "tool") {
    return { role: "assistant", content: [{ type: "output_text", text }] };
  }
  return null;
}

/** Fold only durable model input; streaming deltas do not copy or serialize the context. */
export function foldReplayContext(
  context: AgentReplayContext | undefined,
  event: AgentEvent,
  steps: AgentStepSnapshot[],
): AgentReplayContext | undefined {
  const item = runtimeItemFromEvent(
    event,
    steps.some((step) => step.id === event.stepId && step.kind === "tool"),
  );
  if (!item || context?.limitExceeded) return context;
  const items = [...(context?.items ?? []), item];
  const lastInput =
    event.type === "task.created" || event.type === "task.steered"
      ? String(event.payload.content)
      : context?.lastInput;
  try {
    // Calls in the prefix may still be waiting for a result in the visible event window.
    const bounded = boundAgentContext(items, undefined, true);
    const summarized = bounded.length > 0 && !items.includes(bounded[0]);
    return {
      items: summarized ? bounded.slice(1) : bounded,
      lastInput,
      omitted: context?.omitted || summarized,
    };
  } catch {
    // Preserve the bounded prefix and explicitly block continuation instead of losing instructions.
    return { ...context, items: context?.items ?? [], lastInput, limitExceeded: true };
  }
}

export function sanitizeReplayContext(value: unknown): AgentReplayContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<AgentReplayContext>;
  if (!Array.isArray(raw.items)) return undefined;
  let context: AgentReplayContext | undefined;
  for (const [index, item] of raw.items.entries()) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const content = Array.isArray(record.content) ? record.content : [];
    const text = content
      .map((part) =>
        part && typeof part === "object" && typeof part.text === "string" ? part.text : "",
      )
      .join("");
    const type =
      record.role === "user"
        ? "task.steered"
        : record.role === "assistant"
          ? "step.completed"
          : "context.item";
    context = foldReplayContext(
      context,
      { id: "", taskId: "", seq: index, timestamp: 0, type, payload: { content: text, item } },
      [],
    );
  }
  return {
    items: context?.items ?? [],
    lastInput: typeof raw.lastInput === "string" ? raw.lastInput : context?.lastInput,
    omitted: raw.omitted === true || context?.omitted,
    limitExceeded: raw.limitExceeded === true || context?.limitExceeded,
  };
}
