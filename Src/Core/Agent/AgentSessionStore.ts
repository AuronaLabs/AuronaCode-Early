import type { AgentEvent, AgentTaskSnapshot } from "./AgentTypes";

const STORAGE_KEY = "aurona.ai.agent.sessions.v1";
const LEGACY_KEYS = ["aurona.ai.chat.sessions.v2", "aurona.ai.chat.history.v1"] as const;
const SESSION_LIMIT = 20;
const EVENT_LIMIT = 500;

interface StoredTask extends AgentTaskSnapshot {
  schemaVersion?: 1;
}

interface StoredState {
  activeTaskId: string;
  tasks: StoredTask[];
}

function createId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function emptyTask(id = createId("task")): StoredTask {
  const now = Date.now();
  return {
    schemaVersion: 1,
    id,
    title: "",
    input: "",
    status: "idle",
    createdAt: now,
    updatedAt: now,
    events: [],
    steps: [],
    queuedInputs: [],
    pendingApproval: null,
    activeCheckpointId: null,
    lastError: null,
  };
}

function sanitizeEvent(value: unknown, taskId: string, fallbackSeq: number): AgentEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AgentEvent>;
  if (typeof raw.type !== "string" || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    taskId,
    seq: typeof raw.seq === "number" ? raw.seq : fallbackSeq,
    timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
    type: raw.type as AgentEvent["type"],
    stepId: typeof raw.stepId === "string" ? raw.stepId : undefined,
    payload:
      raw.payload && typeof raw.payload === "object"
        ? (raw.payload as Record<string, unknown>)
        : {},
  };
}

function sanitizeTask(value: unknown): StoredTask | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<StoredTask>;
  if (typeof raw.id !== "string") return null;
  const task = emptyTask(raw.id);
  task.title = typeof raw.title === "string" ? raw.title : "";
  task.input = typeof raw.input === "string" ? raw.input : "";
  task.status = raw.status ?? "idle";
  task.createdAt = typeof raw.createdAt === "number" ? raw.createdAt : task.createdAt;
  task.updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : task.updatedAt;
  task.events = Array.isArray(raw.events)
    ? raw.events
        .map((event, index) => sanitizeEvent(event, task.id, index + 1))
        .filter((event): event is AgentEvent => event !== null)
        .slice(-EVENT_LIMIT)
    : [];
  task.steps = Array.isArray(raw.steps) ? (raw.steps as StoredTask["steps"]).slice(-100) : [];
  task.queuedInputs = Array.isArray(raw.queuedInputs)
    ? raw.queuedInputs.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
  task.pendingApproval = raw.pendingApproval ?? null;
  task.activeCheckpointId = raw.activeCheckpointId ?? null;
  task.lastError = typeof raw.lastError === "string" ? raw.lastError : null;
  task.responseId = typeof raw.responseId === "string" ? raw.responseId : undefined;
  if (
    task.status === "planning" ||
    task.status === "running" ||
    task.status === "waiting_approval"
  ) {
    task.status = "paused";
    task.pendingApproval = null;
  }
  return task;
}

function clearLegacyChatStorage(): void {
  for (const key of LEGACY_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage may be unavailable during early startup; the new Agent store remains usable.
    }
  }
}

function load(): StoredState {
  // 0.4.12 intentionally starts with a clean Agent workspace. Legacy chat data is not
  // promoted into tasks because it cannot faithfully represent checkpoints or approvals.
  clearLegacyChatStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredState>;
      const tasks = Array.isArray(parsed.tasks)
        ? parsed.tasks.map(sanitizeTask).filter((task): task is StoredTask => task !== null)
        : [];
      if (tasks.length > 0) {
        const activeTaskId =
          typeof parsed.activeTaskId === "string" &&
          tasks.some((task) => task.id === parsed.activeTaskId)
            ? parsed.activeTaskId
            : tasks[0].id;
        return { activeTaskId, tasks };
      }
    }
  } catch {
    // Corrupt local state is replaced by a new empty task.
  }
  const initial = emptyTask();
  const tasks = [initial];
  const state = { activeTaskId: initial.id, tasks };
  persist(state);
  return state;
}

function persist(state: StoredState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeTaskId: state.activeTaskId,
        tasks: state.tasks.slice(0, SESSION_LIMIT).map((task) => ({
          ...task,
          events: task.events.slice(-EVENT_LIMIT),
        })),
      }),
    );
  } catch {
    // The in-memory state remains usable when browser storage is full.
  }
}

export interface AgentStoreState {
  activeTaskId: string;
  tasks: StoredTask[];
}

export class AgentSessionStore {
  private state: AgentStoreState = load();

  getState(): AgentStoreState {
    return this.state;
  }

  replace(state: AgentStoreState): void {
    this.state = state;
    persist(state);
  }

  updateTask(taskId: string, updater: (task: StoredTask) => StoredTask): StoredTask | null {
    const index = this.state.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) return null;
    const next = updater(this.state.tasks[index]);
    this.state = {
      activeTaskId: this.state.activeTaskId,
      tasks: [next, ...this.state.tasks.filter((task) => task.id !== taskId)],
    };
    persist(this.state);
    return next;
  }

  createTask(): StoredTask {
    const task = emptyTask();
    this.state = {
      activeTaskId: task.id,
      tasks: [task, ...this.state.tasks].slice(0, SESSION_LIMIT),
    };
    persist(this.state);
    return task;
  }

  setActiveTask(taskId: string): void {
    if (!this.state.tasks.some((task) => task.id === taskId)) return;
    this.state = { activeTaskId: taskId, tasks: this.state.tasks };
    persist(this.state);
  }

  deleteTask(taskId: string): void {
    const remaining = this.state.tasks.filter((task) => task.id !== taskId);
    const tasks = remaining.length > 0 ? remaining : [emptyTask()];
    const activeTaskId = tasks.some((task) => task.id === this.state.activeTaskId)
      ? this.state.activeTaskId
      : tasks[0].id;
    this.state = { activeTaskId, tasks };
    persist(this.state);
  }
}

export { STORAGE_KEY as AGENT_SESSION_STORAGE_KEY };
