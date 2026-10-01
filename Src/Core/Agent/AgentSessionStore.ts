import { replayAgentTask } from "./AgentEventReducer";
import type {
  AgentEvent,
  AgentEventType,
  AgentReplayBase,
  AgentSession,
  AgentTaskSnapshot,
} from "./AgentTypes";

const STORAGE_KEY = "aurona.ai.agent.sessions.v1";
const STAGING_STORAGE_KEY = `${STORAGE_KEY}.staging`;
const CORRUPT_STORAGE_PREFIX = `${STORAGE_KEY}.corrupt.`;
const LEGACY_KEYS = ["aurona.ai.chat.sessions.v2", "aurona.ai.chat.history.v1"] as const;
const SESSION_LIMIT = 20;
const TASK_LIMIT = 100;
const EVENT_LIMIT = 500;
const CORRUPT_BACKUP_LIMIT = 3;

const EVENT_TYPES = new Set<AgentEventType>([
  "task.created",
  "task.queued",
  "task.input_consumed",
  "task.paused",
  "task.resumed",
  "task.completed",
  "task.failed",
  "task.steered",
  "task.aborted",
  "step.started",
  "step.delta",
  "step.completed",
  "tool.requested",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.cancelled",
  "checkpoint.created",
  "checkpoint.restored",
  "artifact.created",
  "response.event",
]);

interface StoredTask extends AgentTaskSnapshot {
  schemaVersion?: 1 | 2;
}

interface StoredSession extends AgentSession {}

interface StoredState {
  activeTaskId: string;
  activeSessionId: string;
  sessions: StoredSession[];
  tasks: StoredTask[];
}

function createId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function emptyTask(id = createId("task"), sessionId = ""): StoredTask {
  const now = Date.now();
  return {
    schemaVersion: 2,
    id,
    sessionId,
    title: "",
    input: "",
    status: "idle",
    createdAt: now,
    updatedAt: now,
    events: [],
    lastEventSeq: 0,
    steps: [],
    queuedInputs: [],
    pendingApproval: null,
    activeCheckpointId: null,
    lastError: null,
  };
}

function emptySession(id = createId("session"), taskId = createId("task")): StoredSession {
  const now = Date.now();
  return {
    id,
    title: "",
    createdAt: now,
    updatedAt: now,
    activeTaskId: taskId,
    taskIds: [taskId],
  };
}

function normalizeRelations(state: StoredState): StoredState {
  const tasks = state.tasks.slice(0, TASK_LIMIT);
  const taskIds = new Set(tasks.map((task) => task.id));
  const sessions = state.sessions
    .slice(0, SESSION_LIMIT)
    .map((session) => {
      const ids = [...new Set(session.taskIds)].filter((id) => taskIds.has(id));
      for (const id of ids) {
        const task = tasks.find((item) => item.id === id);
        if (task) task.sessionId = session.id;
      }
      const activeTaskId = ids.includes(session.activeTaskId)
        ? session.activeTaskId
        : (ids[0] ?? session.activeTaskId);
      return { ...session, taskIds: ids, activeTaskId };
    })
    .filter((session) => session.taskIds.length > 0);
  const sessionByTask = new Set(sessions.flatMap((session) => session.taskIds));
  for (const task of tasks) {
    if (sessionByTask.has(task.id)) continue;
    const sessionId = task.sessionId || createId("session");
    sessions.push({
      id: sessionId,
      title: task.title,
      metadata: undefined,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      activeTaskId: task.id,
      taskIds: [task.id],
    });
    sessionByTask.add(task.id);
    task.sessionId = sessionId;
  }
  const activeTaskId = taskIds.has(state.activeTaskId)
    ? state.activeTaskId
    : (tasks[0]?.id ?? state.activeTaskId);
  const activeSessionId =
    sessions.find((session) => session.taskIds.includes(activeTaskId))?.id ??
    sessions[0]?.id ??
    state.activeSessionId;
  return {
    activeTaskId,
    activeSessionId,
    sessions: sessions.slice(0, SESSION_LIMIT),
    tasks,
  };
}

function sanitizeEvent(value: unknown, taskId: string, fallbackSeq: number): AgentEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AgentEvent>;
  if (typeof raw.type !== "string" || typeof raw.id !== "string") return null;
  if (!EVENT_TYPES.has(raw.type as AgentEventType)) return null;
  const rawSeq = typeof raw.seq === "number" && Number.isSafeInteger(raw.seq) ? raw.seq : 0;
  return {
    id: raw.id,
    taskId,
    seq: rawSeq > 0 ? rawSeq : fallbackSeq,
    timestamp:
      typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)
        ? raw.timestamp
        : Date.now(),
    type: raw.type as AgentEvent["type"],
    stepId: typeof raw.stepId === "string" ? raw.stepId : undefined,
    payload:
      raw.payload && typeof raw.payload === "object"
        ? (raw.payload as Record<string, unknown>)
        : {},
  };
}

const TASK_STATUSES = new Set<AgentTaskSnapshot["status"]>([
  "idle",
  "queued",
  "planning",
  "running",
  "waiting_approval",
  "paused",
  "completed",
  "failed",
  "aborted",
]);

const STEP_KINDS = new Set<AgentTaskSnapshot["steps"][number]["kind"]>([
  "model",
  "tool",
  "approval",
  "checkpoint",
  "artifact",
]);

const STEP_STATUSES = new Set<AgentTaskSnapshot["steps"][number]["status"]>([
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

function sanitizeStep(value: unknown): AgentTaskSnapshot["steps"][number] | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AgentTaskSnapshot["steps"][number]>;
  if (typeof raw.id !== "string" || typeof raw.title !== "string") return null;
  return {
    id: raw.id,
    title: raw.title,
    kind: STEP_KINDS.has(raw.kind as AgentTaskSnapshot["steps"][number]["kind"])
      ? (raw.kind as AgentTaskSnapshot["steps"][number]["kind"])
      : "model",
    status: STEP_STATUSES.has(raw.status as AgentTaskSnapshot["steps"][number]["status"])
      ? (raw.status as AgentTaskSnapshot["steps"][number]["status"])
      : "pending",
    detail: typeof raw.detail === "string" ? raw.detail : undefined,
    toolName: typeof raw.toolName === "string" ? raw.toolName : undefined,
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : undefined,
    completedAt: typeof raw.completedAt === "number" ? raw.completedAt : undefined,
  };
}

function sanitizeApproval(value: unknown): AgentTaskSnapshot["pendingApproval"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<NonNullable<AgentTaskSnapshot["pendingApproval"]>>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.taskId !== "string" ||
    typeof raw.stepId !== "string" ||
    typeof raw.toolName !== "string" ||
    typeof raw.summary !== "string" ||
    typeof raw.args !== "string"
  ) {
    return null;
  }
  return {
    id: raw.id,
    taskId: raw.taskId,
    stepId: raw.stepId,
    toolName: raw.toolName,
    summary: raw.summary,
    args: raw.args,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  };
}

function sanitizeReplayBase(value: unknown): AgentReplayBase | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<AgentReplayBase>;
  if (
    typeof raw.title !== "string" ||
    typeof raw.input !== "string" ||
    !TASK_STATUSES.has(raw.status as AgentTaskSnapshot["status"]) ||
    typeof raw.updatedAt !== "number" ||
    !Array.isArray(raw.steps) ||
    !Array.isArray(raw.queuedInputs) ||
    typeof raw.lastEventSeq !== "number"
  ) {
    return undefined;
  }
  const steps = raw.steps.map(sanitizeStep);
  if (steps.some((step) => step === null)) return undefined;
  return {
    title: raw.title,
    input: raw.input,
    status: raw.status as AgentTaskSnapshot["status"],
    updatedAt: raw.updatedAt,
    steps: steps.filter((step): step is AgentReplayBase["steps"][number] => step !== null),
    queuedInputs: raw.queuedInputs.filter((item): item is string => typeof item === "string"),
    pendingApproval: sanitizeApproval(raw.pendingApproval),
    activeCheckpointId: typeof raw.activeCheckpointId === "string" ? raw.activeCheckpointId : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    responseId: typeof raw.responseId === "string" ? raw.responseId : undefined,
    metadata:
      raw.metadata && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, unknown>)
        : undefined,
    lastEventSeq: raw.lastEventSeq,
  };
}

function sanitizeTask(value: unknown): StoredTask | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<StoredTask>;
  if (typeof raw.id !== "string") return null;
  const task = emptyTask(raw.id, typeof raw.sessionId === "string" ? raw.sessionId : "");
  task.parentTaskId = typeof raw.parentTaskId === "string" ? raw.parentTaskId : undefined;
  task.metadata =
    raw.metadata && typeof raw.metadata === "object"
      ? (raw.metadata as Record<string, unknown>)
      : undefined;
  task.replayBase = sanitizeReplayBase(raw.replayBase);
  task.title = typeof raw.title === "string" ? raw.title : "";
  task.input = typeof raw.input === "string" ? raw.input : "";
  task.status = TASK_STATUSES.has(raw.status as AgentTaskSnapshot["status"])
    ? (raw.status as AgentTaskSnapshot["status"])
    : "idle";
  task.createdAt = typeof raw.createdAt === "number" ? raw.createdAt : task.createdAt;
  task.updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : task.updatedAt;
  let lastEventSeq = 0;
  const rawEvents = Array.isArray(raw.events) ? raw.events : [];
  const sanitizedEvents = rawEvents
    .map((event, index) => sanitizeEvent(event, task.id, index + 1))
    .filter((event): event is AgentEvent => event !== null);
  // Unknown event kinds indicate a schema newer than this build. Do not partially replay the
  // task: returning null makes the caller retain the complete raw payload as a corrupt backup.
  if (sanitizedEvents.length !== rawEvents.length) return null;
  const normalizedEvents = sanitizedEvents.map((event) => {
    const seq = event.seq > lastEventSeq ? event.seq : lastEventSeq + 1;
    lastEventSeq = seq;
    return { ...event, seq };
  });
  task.events = normalizedEvents.slice(-EVENT_LIMIT);
  const storedWatermark =
    typeof raw.lastEventSeq === "number" && Number.isSafeInteger(raw.lastEventSeq)
      ? raw.lastEventSeq
      : 0;
  task.lastEventSeq = Math.max(lastEventSeq, storedWatermark, 0);
  const snapshotSteps = Array.isArray(raw.steps)
    ? raw.steps
        .map(sanitizeStep)
        .filter((step): step is StoredTask["steps"][number] => step !== null)
        .slice(-100)
    : [];
  task.queuedInputs = Array.isArray(raw.queuedInputs)
    ? raw.queuedInputs.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
  task.pendingApproval = sanitizeApproval(raw.pendingApproval);
  task.activeCheckpointId =
    typeof raw.activeCheckpointId === "string" ? raw.activeCheckpointId : null;
  task.lastError = typeof raw.lastError === "string" ? raw.lastError : null;
  task.responseId = typeof raw.responseId === "string" ? raw.responseId : undefined;
  // Event history is authoritative for current state. Keep the snapshot fields as a
  // compatibility seed only when an older payload has no events to replay.
  const hasTrimmedPrefix = task.lastEventSeq > task.events.length;
  if (task.events.length > 0 && (task.replayBase || !hasTrimmedPrefix)) {
    const replayed = replayAgentTask(task, task.events);
    replayed.lastEventSeq = task.lastEventSeq;
    replayed.responseId = task.responseId;
    if (
      replayed.status === "planning" ||
      replayed.status === "running" ||
      replayed.status === "waiting_approval"
    ) {
      replayed.status = "paused";
      replayed.pendingApproval = null;
    }
    return replayed;
  }
  task.steps = snapshotSteps;
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

function rememberCorrupt(raw: string): void {
  try {
    localStorage.setItem(
      `${CORRUPT_STORAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`,
      raw,
    );
    const keys = Object.keys(localStorage)
      .filter((key) => key.startsWith(CORRUPT_STORAGE_PREFIX))
      .sort()
      .reverse();
    for (const key of keys.slice(CORRUPT_BACKUP_LIMIT)) localStorage.removeItem(key);
  } catch {
    // A full or unavailable storage must not prevent a fresh in-memory Agent session.
  }
}

interface DecodedSession {
  state: StoredState;
  hadInvalidTasks: boolean;
}

function decode(raw: string | null): DecodedSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tasks)) return null;
    const tasks = parsed.tasks
      .map(sanitizeTask)
      .filter((task): task is StoredTask => task !== null);
    if (tasks.length === 0) return null;
    const activeTaskId =
      typeof parsed.activeTaskId === "string" &&
      tasks.some((task) => task.id === parsed.activeTaskId)
        ? parsed.activeTaskId
        : tasks[0].id;
    const rawSessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const sessions: StoredSession[] = [];
    const claimed = new Set<string>();
    for (const value of rawSessions) {
      if (!value || typeof value !== "object") continue;
      const rawSession = value as Partial<StoredSession>;
      if (typeof rawSession.id !== "string") continue;
      const taskIds = Array.isArray(rawSession.taskIds)
        ? rawSession.taskIds.filter(
            (id): id is string => typeof id === "string" && tasks.some((task) => task.id === id),
          )
        : [];
      if (taskIds.length === 0) continue;
      const session: StoredSession = {
        id: rawSession.id,
        title: typeof rawSession.title === "string" ? rawSession.title : "",
        metadata:
          rawSession.metadata && typeof rawSession.metadata === "object"
            ? (rawSession.metadata as Record<string, unknown>)
            : undefined,
        createdAt:
          typeof rawSession.createdAt === "number" ? rawSession.createdAt : tasks[0].createdAt,
        updatedAt:
          typeof rawSession.updatedAt === "number" ? rawSession.updatedAt : tasks[0].updatedAt,
        activeTaskId:
          typeof rawSession.activeTaskId === "string" && taskIds.includes(rawSession.activeTaskId)
            ? rawSession.activeTaskId
            : taskIds[0],
        taskIds,
      };
      sessions.push(session);
      for (const id of taskIds) claimed.add(id);
      session.taskIds.forEach((id) => {
        const task = tasks.find((item) => item.id === id);
        if (task && !task.sessionId) task.sessionId = session.id;
      });
    }
    for (const task of tasks) {
      if (claimed.has(task.id)) continue;
      const sessionId = task.sessionId || createId("session");
      task.sessionId = sessionId;
      sessions.push({
        id: sessionId,
        title: task.title,
        metadata: undefined,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        activeTaskId: task.id,
        taskIds: [task.id],
      });
    }
    const activeSessionId =
      typeof parsed.activeSessionId === "string" &&
      sessions.some((item) => item.id === parsed.activeSessionId)
        ? parsed.activeSessionId
        : (sessions.find((item) => item.taskIds.includes(activeTaskId))?.id ?? sessions[0].id);
    return {
      state: normalizeRelations({ activeTaskId, activeSessionId, sessions, tasks }),
      hadInvalidTasks: tasks.length !== parsed.tasks.length,
    };
  } catch {
    return null;
  }
}

function load(): StoredState {
  // 0.4.13 intentionally starts with a clean Agent workspace. Legacy chat data is not
  // promoted into tasks because it cannot faithfully represent checkpoints or approvals.
  clearLegacyChatStorage();
  const primaryRaw = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  const primary = decode(primaryRaw);
  if (primary) {
    if (primary.hadInvalidTasks && primaryRaw) rememberCorrupt(primaryRaw);
    return primary.state;
  }
  if (primaryRaw) rememberCorrupt(primaryRaw);

  const stagingRaw = (() => {
    try {
      return localStorage.getItem(STAGING_STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  const staging = decode(stagingRaw);
  if (staging) {
    persist(staging.state);
    return staging.state;
  }
  if (stagingRaw) rememberCorrupt(stagingRaw);

  const session = emptySession();
  const initial = emptyTask(session.activeTaskId, session.id);
  const tasks = [initial];
  const state = {
    activeTaskId: initial.id,
    activeSessionId: session.id,
    sessions: [session],
    tasks,
  };
  persist(state);
  return state;
}

function persist(state: StoredState): void {
  const serialized = JSON.stringify({
    activeTaskId: state.activeTaskId,
    activeSessionId: state.activeSessionId,
    sessions: state.sessions,
    tasks: state.tasks.slice(0, TASK_LIMIT).map((task) => ({
      ...task,
      events: task.events.slice(-EVENT_LIMIT),
    })),
  });
  try {
    // localStorage has no rename primitive. Stage and validate the complete payload first, then
    // replace the primary slot. If staging or promotion fails, the previous primary remains.
    localStorage.setItem(STAGING_STORAGE_KEY, serialized);
    if (localStorage.getItem(STAGING_STORAGE_KEY) !== serialized) return;
    if (!decode(serialized)) return;
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.removeItem(STAGING_STORAGE_KEY);
  } catch {
    // The in-memory state remains usable when browser storage is full.
  }
}

export interface AgentStoreState {
  activeTaskId: string;
  activeSessionId: string;
  sessions: StoredSession[];
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
    const updated = updater(this.state.tasks[index]);
    const next =
      updated.events.length === 0 && updated.replayBase
        ? { ...updated, replayBase: undefined }
        : updated;
    const sessions = this.state.sessions.map((session) =>
      session.taskIds.includes(taskId) ? { ...session, updatedAt: next.updatedAt } : session,
    );
    this.state = {
      activeTaskId: this.state.activeTaskId,
      activeSessionId: this.state.activeSessionId,
      sessions,
      tasks: [next, ...this.state.tasks.filter((task) => task.id !== taskId)],
    };
    persist(this.state);
    return next;
  }

  createTask(sessionId = this.state.activeSessionId, parentTaskId?: string): StoredTask {
    const task = emptyTask(createId("task"), sessionId);
    task.parentTaskId = parentTaskId;
    const session = this.state.sessions.find((item) => item.id === sessionId);
    const resolvedSession = session ?? emptySession(sessionId, task.id);
    resolvedSession.taskIds = session ? [task.id, ...session.taskIds] : [task.id];
    resolvedSession.activeTaskId = task.id;
    resolvedSession.updatedAt = task.updatedAt;
    this.state = normalizeRelations({
      activeTaskId: task.id,
      activeSessionId: resolvedSession.id,
      sessions: [
        resolvedSession,
        ...this.state.sessions.filter((item) => item.id !== resolvedSession.id),
      ],
      tasks: [task, ...this.state.tasks].slice(0, TASK_LIMIT),
    });
    persist(this.state);
    return task;
  }

  setActiveTask(taskId: string): void {
    const task = this.state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const activeSessionId = task.sessionId ?? this.state.activeSessionId;
    const sessions = this.state.sessions.map((session) =>
      session.id === activeSessionId
        ? { ...session, activeTaskId: taskId, updatedAt: Date.now() }
        : session,
    );
    this.state = {
      activeTaskId: taskId,
      activeSessionId,
      sessions,
      tasks: this.state.tasks,
    };
    persist(this.state);
  }

  setActiveSession(sessionId: string): void {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const activeTaskId = this.state.tasks.some((task) => task.id === session.activeTaskId)
      ? session.activeTaskId
      : session.taskIds.find((id) => this.state.tasks.some((task) => task.id === id));
    if (!activeTaskId) return;
    this.state = {
      activeTaskId,
      activeSessionId: sessionId,
      sessions: this.state.sessions.map((item) =>
        item.id === sessionId ? { ...item, activeTaskId } : item,
      ),
      tasks: this.state.tasks,
    };
    persist(this.state);
  }

  createSession(title = ""): StoredTask {
    const session = emptySession();
    session.title = title;
    const task = emptyTask(session.activeTaskId, session.id);
    this.state = normalizeRelations({
      activeTaskId: task.id,
      activeSessionId: session.id,
      sessions: [session, ...this.state.sessions].slice(0, SESSION_LIMIT),
      tasks: [task, ...this.state.tasks].slice(0, TASK_LIMIT),
    });
    persist(this.state);
    return task;
  }

  deleteTask(taskId: string): void {
    const remaining = this.state.tasks.filter((task) => task.id !== taskId);
    const sessions = this.state.sessions
      .map((session) => {
        const taskIds = session.taskIds.filter((id) => id !== taskId);
        return {
          ...session,
          taskIds,
          activeTaskId:
            session.activeTaskId === taskId
              ? (taskIds[0] ?? session.activeTaskId)
              : session.activeTaskId,
        };
      })
      .filter((session) => session.taskIds.length > 0);
    if (remaining.length === 0) {
      const session = emptySession();
      const task = emptyTask(session.activeTaskId, session.id);
      this.state = {
        activeTaskId: task.id,
        activeSessionId: session.id,
        sessions: [session],
        tasks: [task],
      };
      persist(this.state);
      return;
    }
    const tasks = remaining;
    const activeTaskId = tasks.some((task) => task.id === this.state.activeTaskId)
      ? this.state.activeTaskId
      : tasks[0].id;
    const activeSessionId =
      tasks.find((task) => task.id === activeTaskId)?.sessionId ?? sessions[0]?.id;
    this.state = { activeTaskId, activeSessionId, sessions, tasks };
    persist(this.state);
  }

  deleteSession(sessionId: string): void {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) {
      this.deleteTask(sessionId);
      return;
    }
    const taskIds = new Set(session.taskIds);
    const tasks = this.state.tasks.filter((task) => !taskIds.has(task.id));
    const sessions = this.state.sessions.filter((item) => item.id !== sessionId);
    if (sessions.length === 0 || tasks.length === 0) {
      const fallback = emptySession();
      const task = emptyTask(fallback.activeTaskId, fallback.id);
      this.state = {
        activeTaskId: task.id,
        activeSessionId: fallback.id,
        sessions: [fallback],
        tasks: [task],
      };
      persist(this.state);
      return;
    }
    const activeSession =
      sessions.find((item) => item.id === this.state.activeSessionId) ?? sessions[0];
    const activeTaskId =
      activeSession.taskIds.find((id) => tasks.some((task) => task.id === id)) ?? tasks[0].id;
    this.state = {
      activeTaskId,
      activeSessionId: activeSession.id,
      sessions,
      tasks,
    };
    persist(this.state);
  }
}

export {
  CORRUPT_STORAGE_PREFIX as AGENT_SESSION_CORRUPT_STORAGE_PREFIX,
  replayAgentTask,
  STAGING_STORAGE_KEY as AGENT_SESSION_STAGING_STORAGE_KEY,
  STORAGE_KEY as AGENT_SESSION_STORAGE_KEY,
};
