export type AgentTaskStatus =
  | "idle"
  | "queued"
  | "planning"
  | "running"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "aborted";

export type AgentEventType =
  | "task.created"
  | "task.queued"
  | "task.input_consumed"
  | "task.paused"
  | "task.resumed"
  | "task.completed"
  | "task.failed"
  | "task.steered"
  | "task.aborted"
  | "step.started"
  | "step.delta"
  | "step.completed"
  | "tool.requested"
  | "tool.started"
  | "tool.progress"
  | "tool.completed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "approval.cancelled"
  | "checkpoint.created"
  | "checkpoint.restored"
  | "artifact.created"
  | "response.event";

export interface AgentEvent {
  id: string;
  taskId: string;
  seq: number;
  timestamp: number;
  type: AgentEventType;
  stepId?: string;
  payload: Record<string, unknown>;
}

export interface AgentStepSnapshot {
  id: string;
  title: string;
  kind: "model" | "tool" | "approval" | "checkpoint" | "artifact";
  status: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  detail?: string;
  toolName?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentApprovalRequest {
  id: string;
  taskId: string;
  stepId: string;
  toolName: string;
  summary: string;
  args: string;
  createdAt: number;
}

export interface AgentCheckpoint {
  id: string;
  taskId: string;
  createdAt: number;
  reason: string;
  files: Array<{
    path: string;
    content: string;
    fingerprint: string;
  }>;
  editorViews: Record<string, unknown>;
}

/** State immediately before the first event in the retained event window. */
export interface AgentReplayBase {
  title: string;
  input: string;
  status: AgentTaskStatus;
  updatedAt: number;
  steps: AgentStepSnapshot[];
  queuedInputs: string[];
  pendingApproval: AgentApprovalRequest | null;
  activeCheckpointId: string | null;
  lastError: string | null;
  responseId?: string;
  metadata?: Record<string, unknown>;
  lastEventSeq: number;
}

export interface AgentTaskSnapshot {
  id: string;
  /** Session that owns this execution task. Optional for v1 payload compatibility. */
  sessionId?: string;
  /** Optional predecessor when a task continues a prior task in the same session. */
  parentTaskId?: string;
  /** Extensible task metadata kept separate from event-derived state. */
  metadata?: Record<string, unknown>;
  /** Durable state before the oldest retained event, used for bounded-log replay. */
  replayBase?: AgentReplayBase;
  title: string;
  input: string;
  status: AgentTaskStatus;
  createdAt: number;
  updatedAt: number;
  events: AgentEvent[];
  /** Highest event sequence ever assigned to this task, including trimmed events. */
  lastEventSeq?: number;
  steps: AgentStepSnapshot[];
  queuedInputs: string[];
  pendingApproval: AgentApprovalRequest | null;
  activeCheckpointId: string | null;
  lastError: string | null;
  responseId?: string;
}

export interface AgentTaskMeta {
  id: string;
  sessionId: string;
  parentTaskId?: string;
  title: string;
  status: AgentTaskStatus;
  createdAt: number;
  updatedAt: number;
  eventCount: number;
}

export interface AgentSession {
  id: string;
  title: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  activeTaskId: string;
  taskIds: string[];
}

export interface AgentSessionMeta {
  id: string;
  title: string;
  createdAt: number;
  status: AgentTaskStatus;
  updatedAt: number;
  eventCount: number;
  activeTaskId: string;
  taskCount: number;
  tasks: AgentTaskMeta[];
}

export interface AgentProfileSummary {
  id: string;
  name: string;
  model: string;
  protocol: "responses";
}

export interface AgentSnapshot {
  sessions: AgentSessionMeta[];
  session?: AgentSession;
  sessionTasks: AgentTaskSnapshot[];
  taskHistory: AgentTaskMeta[];
  activeTaskId: string;
  activeTask: AgentTaskSnapshot;
  configured: boolean;
  cardEnabled: boolean;
  profiles: AgentProfileSummary[];
  activeProfileId: string | null;
}

export interface AgentToolOutcome {
  content: string;
  isError: boolean;
  affectedFiles?: string[];
}

/** Effects declared by a tool. The runtime uses these capabilities rather than tool names
 * to decide whether an execution needs a recovery checkpoint. */
export type AgentToolEffect =
  | "filesystem.read"
  | "filesystem.write"
  | "workspace.read"
  | "workspace.modify"
  | "workspace.change"
  | "editor.read"
  | "editor.modify"
  | "command.execute";

export type AgentToolPermission = "read" | "approval-required";

export type AgentToolCheckpointPolicy = "never" | "before-write" | "always";

export type AgentToolRecoverability =
  | "fully-recoverable"
  | "partially-recoverable"
  | "non-recoverable";

export interface AgentToolMetadata {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  effects: readonly AgentToolEffect[];
  permission: AgentToolPermission;
  checkpointPolicy: AgentToolCheckpointPolicy;
  recoverability: AgentToolRecoverability;
}

export interface AgentToolInvocation {
  id: string;
  taskId: string;
  stepId: string;
  name: string;
  arguments: string;
  signal: AbortSignal;
}

export interface AgentToolExecutor {
  execute(invocation: AgentToolInvocation): Promise<AgentToolOutcome>;
  toolPrompt: string;
  definitions?: Array<Record<string, unknown>>;
  /** Resolves concrete workspace files affected by an invocation for checkpoint capture. */
  resolveAffectedFiles?(
    invocation: AgentToolInvocation,
  ): Promise<readonly string[]> | readonly string[];
  /** Metadata is optional for third-party executors; built-ins provide it so the runtime can
   * apply checkpoint and approval policies without knowing concrete tool names. */
  metadata?: readonly AgentToolMetadata[];
  getToolMetadata?(name: string): AgentToolMetadata | undefined;
}
