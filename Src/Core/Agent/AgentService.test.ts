import { reduceAgentEvent } from "./AgentService";
import { AgentSessionStore } from "./AgentSessionStore";
import type { AgentEvent, AgentTaskSnapshot } from "./AgentTypes";

function task(): AgentTaskSnapshot {
  return {
    id: "task-1",
    title: "",
    input: "",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    steps: [],
    queuedInputs: [],
    pendingApproval: null,
    activeCheckpointId: null,
    lastError: null,
  };
}

function event(type: AgentEvent["type"], payload: Record<string, unknown>, seq = 1): AgentEvent {
  return {
    id: `event-${seq}`,
    taskId: "task-1",
    seq,
    timestamp: seq,
    type,
    payload,
  };
}

describe("Agent event reducer", () => {
  it("rebuilds task, step, approval and checkpoint state", () => {
    let state = reduceAgentEvent(task(), event("task.created", { content: "Fix the parser" }));
    state = reduceAgentEvent(state, event("step.started", { title: "Inspect", kind: "model" }, 2));
    const stepId = state.steps[0].id;
    state = reduceAgentEvent(state, {
      ...event(
        "approval.requested",
        {
          approval: {
            id: "approval-1",
            taskId: "task-1",
            stepId,
            toolName: "edit_file",
            summary: "edit",
            args: "{}",
            createdAt: 3,
          },
        },
        3,
      ),
      stepId,
    });
    expect(state.status).toBe("waiting_approval");
    expect(state.pendingApproval?.id).toBe("approval-1");
    state = reduceAgentEvent(state, {
      ...event("approval.cancelled", { approvalId: "approval-1" }, 4),
      stepId,
    });
    state = reduceAgentEvent(
      state,
      event("checkpoint.created", { checkpointId: "checkpoint-1" }, 5),
    );
    expect(state.pendingApproval).toBeNull();
    expect(state.activeCheckpointId).toBe("checkpoint-1");
    expect(state.input).toBe("Fix the parser");
  });

  it("keeps queued inputs bounded and resumes after cancellation", () => {
    let state = task();
    for (let index = 0; index < 25; index++) {
      state = reduceAgentEvent(
        state,
        event("task.queued", { content: `input-${index}` }, index + 1),
      );
    }
    expect(state.queuedInputs).toHaveLength(20);
    state = reduceAgentEvent(state, event("task.resumed", {}, 30));
    expect(state.status).toBe("running");
  });
});

describe("Agent session reset", () => {
  beforeEach(() => localStorage.clear());

  it("removes legacy chat data instead of importing it", () => {
    localStorage.setItem(
      "aurona.ai.chat.sessions.v2",
      JSON.stringify({
        sessions: [
          {
            id: "legacy",
            title: "Old chat",
            messages: [
              { role: "user", content: "hello" },
              { role: "assistant", content: "world" },
            ],
          },
        ],
      }),
    );
    const store = new AgentSessionStore();
    const fresh = store.getState().tasks[0];
    expect(fresh.title).toBe("");
    expect(fresh.events).toEqual([]);
    expect(localStorage.getItem("aurona.ai.chat.sessions.v2")).toBeNull();
  });
});
