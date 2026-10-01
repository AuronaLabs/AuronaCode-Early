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
  | "artifact.created";

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

export interface AgentTaskSnapshot {
  id: string;
  title: string;
  input: string;
  status: AgentTaskStatus;
  createdAt: number;
  updatedAt: number;
  events: AgentEvent[];
  steps: AgentStepSnapshot[];
  queuedInputs: string[];
  pendingApproval: AgentApprovalRequest | null;
  activeCheckpointId: string | null;
  lastError: string | null;
  responseId?: string;
}

export interface AgentSessionMeta {
  id: string;
  title: string;
  status: AgentTaskStatus;
  updatedAt: number;
  eventCount: number;
}

export interface AgentProfileSummary {
  id: string;
  name: string;
  model: string;
  protocol: "responses";
}

export interface AgentSnapshot {
  sessions: AgentSessionMeta[];
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
}
