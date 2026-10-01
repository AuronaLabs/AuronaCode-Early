import { AgentSessionStore } from "./AgentSessionStore";

describe("Agent session store relationships", () => {
  beforeEach(() => localStorage.clear());

  it("keeps active task and session aligned when creating and switching tasks", () => {
    const store = new AgentSessionStore();
    const initial = store.getState();
    const firstSession = initial.activeSessionId;
    const next = store.createTask(firstSession, initial.activeTaskId);

    expect(store.getState().activeTaskId).toBe(next.id);
    expect(store.getState().activeSessionId).toBe(firstSession);
    expect(store.getState().sessions[0].activeTaskId).toBe(next.id);

    store.setActiveTask(initial.activeTaskId);
    expect(store.getState().activeTaskId).toBe(initial.activeTaskId);
    expect(store.getState().sessions[0].activeTaskId).toBe(initial.activeTaskId);
  });

  it("does not let task limits leave dangling session references", () => {
    const store = new AgentSessionStore();
    const sessionId = store.getState().activeSessionId;
    for (let index = 0; index < 105; index++) store.createTask(sessionId);

    const state = store.getState();
    const taskIds = new Set(state.tasks.map((task) => task.id));
    expect(state.tasks.length).toBeLessThanOrEqual(100);
    expect(state.sessions.length).toBeLessThanOrEqual(20);
    for (const session of state.sessions) {
      expect(session.taskIds.every((id) => taskIds.has(id))).toBe(true);
      expect(taskIds.has(session.activeTaskId)).toBe(true);
    }
  });

  it("keeps a session title stable when a task receives its first input", () => {
    const store = new AgentSessionStore();
    const sessionId = store.getState().activeSessionId;
    store.updateTask(store.getState().activeTaskId, (task) => ({
      ...task,
      title: "Task title",
      updatedAt: Date.now(),
    }));
    expect(store.getState().sessions.find((session) => session.id === sessionId)?.title).toBe("");
  });
});
