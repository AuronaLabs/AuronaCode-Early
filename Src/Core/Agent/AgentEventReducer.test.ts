import { reduceAgentEvent, replayAgentTask } from "./AgentEventReducer";
import type { AgentEvent, AgentTaskSnapshot } from "./AgentTypes";

function task(): AgentTaskSnapshot {
  return {
    id: "task-1",
    sessionId: "session-1",
    title: "",
    input: "",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    lastEventSeq: 0,
    steps: [],
    queuedInputs: [],
    pendingApproval: null,
    activeCheckpointId: null,
    lastError: null,
  };
}

function event(
  type: AgentEvent["type"],
  payload: Record<string, unknown>,
  seq: number,
): AgentEvent {
  return { id: `event-${seq}`, taskId: "task-1", seq, timestamp: seq, type, payload };
}

describe("Agent event replay", () => {
  it("retains a baseline when the event window is bounded", () => {
    let state = reduceAgentEvent(task(), {
      ...event("step.started", { title: "Inspect", kind: "model" }, 1),
      stepId: "step-1",
    });
    for (let seq = 2; seq <= 501; seq++) {
      state = reduceAgentEvent(state, {
        ...event("step.delta", { content: String(seq) }, seq),
        stepId: "step-1",
      });
    }
    expect(state.events).toHaveLength(500);
    expect(state.events[0].seq).toBe(2);
    expect(state.replayBase?.steps[0].id).toBe("step-1");
    expect(state.replayBase?.lastEventSeq).toBe(1);

    const restored = replayAgentTask(state, state.events);
    expect(restored.steps[0].status).toBe("running");
    expect(restored.steps[0].detail).toContain("501");
    expect(restored.lastEventSeq).toBe(501);
  });

  it("does not resurrect consumed queued input during replay", () => {
    let state = task();
    state = reduceAgentEvent(state, event("task.queued", { content: "first" }, 1));
    state = reduceAgentEvent(state, event("task.queued", { content: "second" }, 2));
    state = reduceAgentEvent(state, event("task.input_consumed", { content: "first" }, 3));
    const restored = replayAgentTask(state);
    expect(restored.queuedInputs).toEqual(["second"]);
  });

  it("preserves checkpoint state when the checkpoint event is trimmed", () => {
    let state = reduceAgentEvent(task(), event("checkpoint.created", { checkpointId: "cp-1" }, 1));
    for (let seq = 2; seq <= 501; seq++) {
      state = reduceAgentEvent(state, event("step.delta", { content: "." }, seq));
    }
    expect(state.replayBase?.activeCheckpointId).toBe("cp-1");
    expect(replayAgentTask(state).activeCheckpointId).toBe("cp-1");
  });
});
