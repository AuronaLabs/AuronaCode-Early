const storage = vi.hoisted(() => ({ values: new Map<string, string>(), write: vi.fn() }));
vi.mock("../../Foundation/IPC/AgentStorageCommands", () => ({
  AgentStorageIPC: {
    read: vi.fn(async (slot: string) => storage.values.get(slot) ?? null),
    write: storage.write,
  },
}));

import { reduceAgentEvent, replayAgentTask } from "./AgentService";
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
  it("replays an event log into current task state without using stale snapshot fields", () => {
    const seed = { ...task(), sessionId: "session-1", parentTaskId: "task-0", title: "stale" };
    const events: AgentEvent[] = [
      event("task.created", { content: "Fix auth" }, 1),
      { ...event("step.started", { title: "Inspect", kind: "model" }, 2), stepId: "step-1" },
      { ...event("step.delta", { content: "reading" }, 3), stepId: "step-1" },
      { ...event("step.completed", { content: "done" }, 4), stepId: "step-1" },
      event("task.completed", {}, 5),
    ];
    const replayed = replayAgentTask(seed, events);
    expect(replayed.title).toBe("Fix auth");
    expect(replayed.status).toBe("completed");
    expect(replayed.steps[0].detail).toBe("done");
    expect(replayed.sessionId).toBe("session-1");
    expect(replayed.parentTaskId).toBe("task-0");
  });

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

  it("keeps follow-up instructions on the same task", () => {
    let state = reduceAgentEvent(task(), event("task.created", { content: "Inspect flicker" }));
    state = reduceAgentEvent(state, event("task.completed", {}, 2));
    state = reduceAgentEvent(
      state,
      event("task.steered", { content: "Now patch the renderer" }, 3),
    );
    expect(state.id).toBe("task-1");
    expect(state.input).toBe("Now patch the renderer");
    expect(state.status).toBe("running");
  });

  it("does not mutate the previous snapshot when updating a step", () => {
    const started = reduceAgentEvent(task(), {
      ...event("step.started", { title: "Inspect", kind: "model" }, 1),
      stepId: "step-1",
    });
    const previous = structuredClone(started);

    const updated = reduceAgentEvent(started, {
      ...event("step.delta", { content: "reading" }, 2),
      stepId: "step-1",
    });

    expect(started).toEqual(previous);
    expect(updated.steps[0].detail).toBe("reading");
  });

  it("keeps a sequence watermark after visible events are trimmed or cleared", () => {
    let state = task();
    for (let seq = 1; seq <= 505; seq++) {
      state = reduceAgentEvent(state, event("step.delta", { content: String(seq) }, seq));
    }
    expect(state.events).toHaveLength(500);
    expect(state.events[0].seq).toBe(6);
    expect(state.lastEventSeq).toBe(505);

    const cleared = { ...state, events: [] };
    const next = reduceAgentEvent(cleared, event("task.queued", { content: "next" }, 506));
    expect(next.lastEventSeq).toBe(506);
  });

  it("retains forward-compatible response events in the replay log", () => {
    const next = reduceAgentEvent(
      task(),
      event("response.event", {
        eventType: "response.future_event",
        rawEvent: { type: "response.future_event", data: { value: 42 } },
      }),
    );
    expect(next.events[0].type).toBe("response.event");
    expect(next.events[0].payload).toMatchObject({ eventType: "response.future_event" });
  });
});

describe("Agent session reset", () => {
  beforeEach(() => {
    localStorage.clear();
    storage.values.clear();
    storage.write.mockReset().mockImplementation(async (slot: string, content: string) => {
      storage.values.set(slot, content);
    });
  });

  it("archives legacy chat without replaying it as new Agent tasks", async () => {
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
    await store.initialize();
    const fresh = store.getState().tasks[0];
    expect(fresh.title).toBe("");
    expect(fresh.events).toEqual([]);
    expect(localStorage.getItem("aurona.ai.chat.sessions.v2")).toBeNull();
    expect(JSON.parse(storage.values.get("legacy-chat") ?? "{}").records[0].content).toContain(
      "Old chat",
    );
  });

  it("keeps session metadata separate from task history", () => {
    const store = new AgentSessionStore();
    const first = store.getState();
    const firstSessionId = first.activeSessionId;
    const second = store.createTask(firstSessionId, first.activeTaskId);
    const state = store.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].taskIds).toEqual([second.id, first.activeTaskId]);
    expect(state.sessions[0].activeTaskId).toBe(second.id);
    expect(second.sessionId).toBe(firstSessionId);
    expect(second.parentTaskId).toBe(first.activeTaskId);
    expect(state.tasks.map((item) => item.id)).toContain(first.activeTaskId);
  });

  it("replays persisted task events when a store is restored", async () => {
    const { AGENT_SESSION_STORAGE_KEY } = await import("./AgentSessionStore");
    localStorage.setItem(
      AGENT_SESSION_STORAGE_KEY,
      JSON.stringify({
        activeTaskId: "task-1",
        tasks: [
          {
            id: "task-1",
            title: "stale snapshot",
            input: "stale",
            status: "running",
            createdAt: 1,
            updatedAt: 4,
            events: [
              {
                id: "event-1",
                taskId: "task-1",
                type: "task.created",
                seq: 1,
                timestamp: 2,
                payload: { content: "Recover this" },
              },
              {
                id: "event-2",
                taskId: "task-1",
                type: "task.completed",
                seq: 2,
                timestamp: 3,
                payload: {},
              },
            ],
            steps: [],
            queuedInputs: [],
            pendingApproval: null,
            activeCheckpointId: null,
            lastError: null,
          },
        ],
      }),
    );
    const store = new AgentSessionStore();
    await store.initialize();
    const restored = store.getState().tasks[0];
    expect(restored.title).toBe("Recover this");
    expect(restored.input).toBe("Recover this");
    expect(restored.status).toBe("completed");
  });

  it("preserves the original and blocks writes when the session payload is corrupt", async () => {
    const { AGENT_SESSION_STORAGE_KEY } = await import("./AgentSessionStore");
    localStorage.setItem(AGENT_SESSION_STORAGE_KEY, "{not-json");

    const store = new AgentSessionStore();
    await expect(store.initialize()).rejects.toThrow("malformed");
    expect(store.getState().tasks).toHaveLength(1);
    expect(localStorage.getItem(AGENT_SESSION_STORAGE_KEY)).toBe("{not-json");
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("normalizes legacy event sequences and preserves the stored watermark", async () => {
    const { AGENT_SESSION_STORAGE_KEY } = await import("./AgentSessionStore");
    localStorage.setItem(
      AGENT_SESSION_STORAGE_KEY,
      JSON.stringify({
        activeTaskId: "task-1",
        tasks: [
          {
            id: "task-1",
            events: [
              { id: "event-1", type: "task.created", seq: 3, timestamp: 1, payload: {} },
              { id: "event-2", type: "task.queued", seq: 3, timestamp: 2, payload: {} },
              { id: "event-3", type: "task.queued", seq: -1, timestamp: 3, payload: {} },
            ],
            lastEventSeq: 99,
          },
        ],
      }),
    );

    const store = new AgentSessionStore();
    await store.initialize();
    const task = store.getState().tasks[0];
    expect(task.events.map((item) => item.seq)).toEqual([3, 4, 5]);
    expect(task.lastEventSeq).toBe(99);
  });

  it("preserves sessions containing unknown event types without partial migration", async () => {
    const { AGENT_SESSION_STORAGE_KEY } = await import("./AgentSessionStore");
    localStorage.setItem(
      AGENT_SESSION_STORAGE_KEY,
      JSON.stringify({
        activeTaskId: "task-1",
        tasks: [
          {
            id: "task-1",
            events: [
              { id: "known", type: "task.created", seq: 1, timestamp: 1, payload: {} },
              { id: "unknown", type: "legacy.message", seq: 2, timestamp: 2, payload: {} },
            ],
            lastEventSeq: 2,
          },
        ],
      }),
    );

    const store = new AgentSessionStore();
    await expect(store.initialize()).rejects.toThrow("malformed");
    const restored = store.getState().tasks[0];

    expect(restored.events).toEqual([]);
    expect(localStorage.getItem(AGENT_SESSION_STORAGE_KEY)).not.toBeNull();
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("leaves the previous primary payload intact when promotion fails", async () => {
    const { AGENT_SESSION_STORAGE_KEY } = await import("./AgentSessionStore");
    const original = JSON.stringify({
      activeTaskId: "old",
      tasks: [
        {
          id: "old",
          title: "Old",
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
        },
      ],
    });
    localStorage.setItem(AGENT_SESSION_STORAGE_KEY, original);
    storage.write.mockRejectedValueOnce(new Error("keyring unavailable"));
    const store = new AgentSessionStore();
    await expect(store.initialize()).rejects.toThrow("keyring");
    expect(localStorage.getItem(AGENT_SESSION_STORAGE_KEY)).toBe(original);
    expect(storage.values.has("sessions")).toBe(false);
    await store.initialize();
    expect(localStorage.getItem(AGENT_SESSION_STORAGE_KEY)).toBeNull();
    const previous = storage.values.get("sessions");
    storage.write.mockRejectedValueOnce(new Error("disk full"));
    store.createTask();
    await expect(store.flush()).rejects.toThrow("disk full");
    expect(storage.values.get("sessions")).toBe(previous);
  });
});
