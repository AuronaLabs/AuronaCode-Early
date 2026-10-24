const storage = vi.hoisted(() => ({ values: new Map<string, string>(), write: vi.fn() }));
vi.mock("../../Foundation/IPC/AgentStorageCommands", () => ({
  AgentStorageIPC: {
    read: vi.fn(async (slot: string) => storage.values.get(slot) ?? null),
    write: storage.write,
  },
}));

import { buildAgentRuntimeInput, reduceAgentEvent, replayAgentTask } from "./AgentService";
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
  it("restores original instructions and tool pairs across the bounded event window", async () => {
    let state = reduceAgentEvent(
      task(),
      event("task.created", { content: "Keep the original requirement" }, 1),
    );
    const call = {
      type: "function_call",
      call_id: "cross-boundary",
      name: "read_file",
      arguments: "{}",
    };
    const output = {
      type: "function_call_output",
      call_id: "cross-boundary",
      output: "file content",
    };
    state = reduceAgentEvent(state, event("context.item", { item: call }, 2));
    for (let seq = 3; seq <= 503; seq++)
      state = reduceAgentEvent(state, event("step.delta", { content: "." }, seq));
    state = reduceAgentEvent(state, event("context.item", { item: output }, 504));
    state = reduceAgentEvent(state, event("task.steered", { content: "Now fix it" }, 505));
    const input = buildAgentRuntimeInput({ tasks: [state], sessions: [] }, state.id, "Now fix it");
    expect(input).toContainEqual(call);
    expect(input).toContainEqual(output);
    expect(JSON.stringify(input)).toContain("Keep the original requirement");
    expect(input.filter((item) => JSON.stringify(item).includes("Now fix it"))).toHaveLength(1);
    // Let the output enter the prefix too, then pass through the real storage decoder.
    for (let seq = 506; seq <= 1006; seq++)
      state = reduceAgentEvent(state, event("step.delta", { content: "." }, seq));
    storage.values.clear();
    storage.write.mockImplementation(async (slot: string, content: string) => {
      storage.values.set(slot, content);
    });
    const store = new AgentSessionStore();
    await store.initialize();
    store.replace({ ...store.getState(), activeTaskId: state.id, tasks: [state] });
    await store.flush();
    const restored = new AgentSessionStore();
    await restored.initialize();
    const recovered = buildAgentRuntimeInput(restored.getState(), state.id, "Now fix it");
    expect(recovered).toEqual(input);
    restored.updateTask(state.id, (current) => ({ ...current, events: [], steps: [] }));
    expect(restored.getState().tasks[0].replayBase).toBeUndefined();
    expect(buildAgentRuntimeInput(restored.getState(), state.id, "Fresh input")).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Fresh input" }] },
    ]);
  });

  it("blocks continuation explicitly when archived instructions exceed the context budget", () => {
    let state = reduceAgentEvent(
      task(),
      event("task.created", { content: "x".repeat(128_000) }, 1),
    );
    for (let seq = 2; seq <= 502; seq++)
      state = reduceAgentEvent(state, event("step.delta", { content: "." }, seq));
    expect(state.replayBase?.context?.limitExceeded).toBe(true);
    expect(() =>
      buildAgentRuntimeInput({ tasks: [state], sessions: [] }, state.id, "Continue"),
    ).toThrow("context_limit");
  });

  it("bounds archived tool output while retaining instructions and recent complete pairs", () => {
    let state = reduceAgentEvent(
      task(),
      event("task.created", { content: "Keep this requirement" }, 1),
    );
    const call = { type: "function_call", call_id: "large", name: "read_file", arguments: "{}" };
    state = reduceAgentEvent(state, event("context.item", { item: call }, 2));
    state = reduceAgentEvent(
      state,
      event(
        "context.item",
        { item: { type: "function_call_output", call_id: "large", output: "x".repeat(130_000) } },
        3,
      ),
    );
    for (let seq = 4; seq <= 505; seq++)
      state = reduceAgentEvent(state, event("step.delta", { content: "." }, seq));
    const recentCall = { ...call, call_id: "recent" };
    const recentOutput = { type: "function_call_output", call_id: "recent", output: "current" };
    state = reduceAgentEvent(state, event("context.item", { item: recentCall }, 506));
    state = reduceAgentEvent(state, event("context.item", { item: recentOutput }, 507));
    const input = buildAgentRuntimeInput({ tasks: [state], sessions: [] }, state.id, "Continue");
    expect(state.replayBase?.context?.omitted).toBe(true);
    expect(JSON.stringify(input)).toContain("Keep this requirement");
    expect(input).not.toContainEqual(call);
    expect(input).toContainEqual(recentCall);
    expect(input).toContainEqual(recentOutput);
    expect(JSON.stringify(state.replayBase?.context).length).toBeLessThan(128_000);
  });
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

describe("Agent runtime context recovery", () => {
  it("rebuilds persisted tool calls and results as complete Responses pairs", () => {
    const taskSnapshot = task();
    taskSnapshot.sessionId = "session-1";
    taskSnapshot.events = [
      event("task.created", { content: "Inspect the workspace" }, 1),
      event("step.completed", { content: "I will inspect the files first." }, 2),
      event(
        "context.item",
        {
          item: {
            type: "function_call",
            call_id: "call-1",
            name: "list_dir",
            arguments: '{"path":"."}',
          },
        },
        3,
      ),
      event(
        "context.item",
        {
          item: { type: "function_call_output", call_id: "call-1", output: "src/" },
        },
        4,
      ),
    ];
    const input = buildAgentRuntimeInput(
      {
        sessions: [
          {
            id: "session-1",
            title: "",
            createdAt: 1,
            updatedAt: 4,
            activeTaskId: taskSnapshot.id,
            taskIds: [taskSnapshot.id],
          },
        ],
        tasks: [taskSnapshot],
      },
      taskSnapshot.id,
      "Continue from the recovered context",
    );
    expect(input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Inspect the workspace" }] },
      {
        role: "assistant",
        content: [{ type: "output_text", text: "I will inspect the files first." }],
      },
      {
        type: "function_call",
        call_id: "call-1",
        name: "list_dir",
        arguments: '{"path":"."}',
      },
      { type: "function_call_output", call_id: "call-1", output: "src/" },
      {
        role: "user",
        content: [{ type: "input_text", text: "Continue from the recovered context" }],
      },
    ]);
  });

  it("drops an orphaned persisted call instead of sending an invalid pair", () => {
    const taskSnapshot = task();
    taskSnapshot.sessionId = "session-1";
    taskSnapshot.events = [
      event("task.created", { content: "Inspect" }, 1),
      event(
        "context.item",
        { item: { type: "function_call", call_id: "call-1", name: "list_dir", arguments: "{}" } },
        2,
      ),
    ];
    const input = buildAgentRuntimeInput(
      {
        sessions: [
          {
            id: "session-1",
            title: "",
            createdAt: 1,
            updatedAt: 2,
            activeTaskId: taskSnapshot.id,
            taskIds: [taskSnapshot.id],
          },
        ],
        tasks: [taskSnapshot],
      },
      taskSnapshot.id,
      "Retry",
    );
    expect(input.some((item) => (item as { type?: string }).type === "function_call")).toBe(false);
    expect(input.at(-1)).toEqual({
      role: "user",
      content: [{ type: "input_text", text: "Retry" }],
    });
    expect(JSON.stringify(input)).toContain("Context summary");
  });

  it("does not replay a retained tool completion as assistant text after its start event is trimmed", () => {
    const taskSnapshot = task();
    taskSnapshot.sessionId = "session-1";
    taskSnapshot.events = [
      event("task.created", { content: "Inspect" }, 1),
      event("step.completed", { content: "directory listing", kind: "tool" }, 2),
    ];
    const input = buildAgentRuntimeInput(
      {
        sessions: [
          {
            id: "session-1",
            title: "",
            createdAt: 1,
            updatedAt: 2,
            activeTaskId: taskSnapshot.id,
            taskIds: [taskSnapshot.id],
          },
        ],
        tasks: [taskSnapshot],
      },
      taskSnapshot.id,
      "Continue",
    );
    expect(input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Inspect" }] },
      { role: "user", content: [{ type: "input_text", text: "Continue" }] },
    ]);
  });

  it("does not duplicate the current task input when retrying after later tool output", () => {
    const taskSnapshot = task();
    taskSnapshot.sessionId = "session-1";
    taskSnapshot.events = [
      event("task.created", { content: "Inspect this workspace" }, 1),
      event("step.completed", { content: "Initial inspection" }, 2),
      event(
        "context.item",
        {
          item: {
            type: "function_call",
            call_id: "call-1",
            name: "list_dir",
            arguments: "{}",
          },
        },
        3,
      ),
      event(
        "context.item",
        { item: { type: "function_call_output", call_id: "call-1", output: "src/" } },
        4,
      ),
    ];
    const input = buildAgentRuntimeInput(
      {
        sessions: [
          {
            id: "session-1",
            title: "",
            createdAt: 1,
            updatedAt: 4,
            activeTaskId: taskSnapshot.id,
            taskIds: [taskSnapshot.id],
          },
        ],
        tasks: [taskSnapshot],
      },
      taskSnapshot.id,
      "Inspect this workspace",
    );
    expect(
      input.filter(
        (item) =>
          (item as { role?: string; content?: Array<{ text?: string }> }).role === "user" &&
          (item as { content?: Array<{ text?: string }> }).content?.[0]?.text ===
            "Inspect this workspace",
      ),
    ).toHaveLength(1);
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
