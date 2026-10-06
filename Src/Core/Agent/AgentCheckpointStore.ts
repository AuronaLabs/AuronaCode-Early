import { AgentStorageIPC } from "../../Foundation/IPC/AgentStorageCommands";
import { FileSystemCommands } from "../../Foundation/IPC/FileSystemCommands";
import type { EditorViewState } from "../../Foundation/Types/Editor";
import { DocumentService } from "../DocumentService";
import { EditorAdapter } from "../Editor/EditorAdapter";
import { WorkspaceService } from "../WorkspaceService";
import type { AgentCheckpoint } from "./AgentTypes";
import { SecureAgentStore } from "./SecureAgentStore";

const STORAGE_KEY = "aurona.ai.agent.checkpoints.v1";
const STAGING_STORAGE_KEY = `${STORAGE_KEY}.staging`;
const CORRUPT_STORAGE_PREFIX = `${STORAGE_KEY}.corrupt.`;
const CHECKPOINT_LIMIT = 40;
let mutationActive = false;

async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  if (mutationActive)
    throw new Error("[agent.recovery_busy] Another checkpoint operation is active");
  mutationActive = true;
  try {
    return await work();
  } finally {
    mutationActive = false;
  }
}

interface RecoveryFile {
  path: string;
  content: string;
}
interface RecoveryJournal {
  schema: 1;
  checkpointId: string;
  workspaceId: string;
  originals: RecoveryFile[];
  targets: RecoveryFile[];
}

function decodeJournal(raw: string): RecoveryJournal {
  const value = JSON.parse(raw) as Partial<RecoveryJournal> | null;
  const validFile = (file: unknown): file is RecoveryFile => {
    if (!file || typeof file !== "object") return false;
    const record = file as Partial<RecoveryFile>;
    return (
      typeof record.path === "string" &&
      record.path.length > 0 &&
      record.path.length <= 32768 &&
      typeof record.content === "string" &&
      new TextEncoder().encode(record.content).byteLength <= 32 * 1024 * 1024
    );
  };
  if (
    value?.schema !== 1 ||
    typeof value.checkpointId !== "string" ||
    typeof value.workspaceId !== "string" ||
    !Array.isArray(value.originals) ||
    !Array.isArray(value.targets) ||
    value.originals.length > 10000 ||
    value.originals.length !== value.targets.length ||
    !value.originals.every(validFile) ||
    !value.targets.every(validFile) ||
    new Set(value.originals.map((file) => file.path)).size !== value.originals.length ||
    value.originals.some((file, index) => file.path !== value.targets?.[index].path)
  )
    throw new Error("[agent.recovery_schema] Invalid recovery journal; preserved for inspection");
  return value as RecoveryJournal;
}

async function readCurrent(path: string): Promise<string> {
  return DocumentService.get(path)?.content ?? FileSystemCommands.readTextFile(path);
}

async function writeCompared(
  path: string,
  content: string,
  expected: string,
  generation: number,
): Promise<void> {
  if ((await FileSystemCommands.generation()) !== generation)
    throw new Error("[workspace.generation] Workspace changed during recovery");
  const document = DocumentService.get(path);
  if (document?.openState === "open") {
    const revision = document.version;
    if (document.content !== expected)
      throw new Error(`[agent.recovery_conflict] Editor changed: ${path}`);
    await DocumentService.applyEdits(
      path,
      [{ startUtf16: 0, endUtf16: document.content.length, text: content }],
      content,
      "external",
      revision,
    );
  } else {
    await FileSystemCommands.writeCompare(
      path,
      content,
      (await fingerprint(expected)).slice(7),
      generation,
    );
  }
}

function legacyFingerprint(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

async function fingerprint(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}:${bytes.length}`;
}

async function matchesFingerprint(content: string, expected: string): Promise<boolean> {
  return expected.startsWith("sha256:")
    ? (await fingerprint(content)) === expected
    : legacyFingerprint(content) === expected;
}

function createId(): string {
  try {
    return `checkpoint-${crypto.randomUUID()}`;
  } catch {
    return `checkpoint-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function sanitizeCheckpoint(value: unknown): AgentCheckpoint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AgentCheckpoint>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.taskId !== "string" ||
    typeof raw.reason !== "string" ||
    typeof raw.createdAt !== "number" ||
    !Number.isFinite(raw.createdAt) ||
    !Array.isArray(raw.files) ||
    !raw.editorViews ||
    typeof raw.editorViews !== "object"
  ) {
    return null;
  }
  const files = raw.files.filter(
    (file): file is AgentCheckpoint["files"][number] =>
      Boolean(file) &&
      typeof file === "object" &&
      typeof file.path === "string" &&
      typeof file.content === "string" &&
      typeof file.fingerprint === "string" &&
      (file.afterFingerprint === undefined || typeof file.afterFingerprint === "string"),
  );
  if (files.length !== raw.files.length) return null;
  return {
    id: raw.id,
    workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : undefined,
    taskId: raw.taskId,
    createdAt: raw.createdAt,
    reason: raw.reason,
    files,
    editorViews: raw.editorViews as Record<string, unknown>,
  };
}

function decode(raw: string | null): AgentCheckpoint[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    const checkpoints = value
      .map(sanitizeCheckpoint)
      .filter((checkpoint): checkpoint is AgentCheckpoint => checkpoint !== null);
    return checkpoints.length === value.length ? checkpoints.slice(0, CHECKPOINT_LIMIT) : null;
  } catch {
    return null;
  }
}

export class AgentCheckpointStore {
  private checkpoints: AgentCheckpoint[] = [];
  private readonly persistence = new SecureAgentStore("checkpoints");
  private initialization: Promise<void> | null = null;

  initialize(): Promise<void> {
    this.initialization ??= this.persistence
      .load([STORAGE_KEY, STAGING_STORAGE_KEY], (raw) => decode(raw) !== null)
      .then((raw) => {
        this.checkpoints = decode(raw) ?? [];
      })
      .catch((error) => {
        this.initialization = null;
        throw error;
      });
    return this.initialization;
  }

  private async persist(checkpoints = this.checkpoints): Promise<void> {
    const serialized = JSON.stringify(checkpoints);
    if (new TextEncoder().encode(serialized).byteLength > 256 * 1024 * 1024)
      throw new Error("[agent.quota] Checkpoint storage exceeds 256 MiB");
    await this.persistence.write(serialized);
  }

  async capture(taskId: string, paths: string[], reason: string): Promise<AgentCheckpoint> {
    return exclusive(() => this.captureInternal(taskId, paths, reason));
  }

  private async captureInternal(
    taskId: string,
    paths: string[],
    reason: string,
  ): Promise<AgentCheckpoint> {
    await this.initialize();
    if (await this.hasPendingRestore())
      throw new Error("[agent.recovery_pending] Recover the unfinished restore before editing");
    const generation = await FileSystemCommands.generation();
    const uniquePaths = [...new Set(paths.filter((path) => path.trim() !== ""))];
    const files: AgentCheckpoint["files"] = [];
    for (const path of uniquePaths) {
      const document = DocumentService.get(path);
      const content = document?.content ?? (await FileSystemCommands.readTextFile(path));
      if (new TextEncoder().encode(content).byteLength > 32 * 1024 * 1024)
        throw new Error("[agent.quota] Checkpoint file exceeds 32 MiB");
      files.push({ path, content, fingerprint: await fingerprint(content) });
    }
    if ((await FileSystemCommands.generation()) !== generation)
      throw new Error("[workspace.generation] Workspace changed during checkpoint capture");
    const status = EditorAdapter.getStatus();
    const view = EditorAdapter.getViewState();
    const checkpoint: AgentCheckpoint = {
      id: createId(),
      taskId,
      createdAt: Date.now(),
      reason,
      workspaceId: WorkspaceService.getCurrent().id,
      files,
      editorViews: status.path
        ? {
            [status.path]: view ?? {
              path: status.path,
              line: status.line,
              column: status.column,
              scrollTop: 0,
              scrollLeft: 0,
            },
          }
        : {},
    };
    const next = [checkpoint, ...this.checkpoints];
    while (next.length > CHECKPOINT_LIMIT) {
      let index = next.length - 1;
      while (index > 0 && next[index].files.some((file) => file.afterFingerprint === undefined))
        index--;
      if (index <= 0) throw new Error("[agent.quota] Unfinished checkpoints cannot be evicted");
      next.splice(index, 1);
    }
    await this.persist(next);
    this.checkpoints = next;
    return checkpoint;
  }

  get(id: string): AgentCheckpoint | null {
    return this.checkpoints.find((checkpoint) => checkpoint.id === id) ?? null;
  }

  listForTask(taskId: string): AgentCheckpoint[] {
    return this.checkpoints.filter((checkpoint) => checkpoint.taskId === taskId);
  }

  async seal(id: string): Promise<void> {
    return exclusive(() => this.sealInternal(id));
  }

  private async sealInternal(id: string): Promise<void> {
    await this.initialize();
    const checkpoint = this.get(id);
    if (!checkpoint) throw new Error("Checkpoint not found");
    const fingerprints = await Promise.all(
      checkpoint.files.map(async (file) => {
        const current =
          DocumentService.get(file.path)?.content ??
          (await FileSystemCommands.readTextFile(file.path));
        return fingerprint(current);
      }),
    );
    const next = this.checkpoints.map((item) =>
      item.id === id
        ? {
            ...item,
            files: item.files.map((file, index) => ({
              ...file,
              afterFingerprint: fingerprints[index],
            })),
          }
        : item,
    );
    await this.persist(next);
    this.checkpoints = next;
  }

  async restore(id: string): Promise<void> {
    return exclusive(() => this.restoreInternal(id));
  }

  private async restoreInternal(id: string): Promise<void> {
    await this.initialize();
    const checkpoint = this.get(id);
    if (!checkpoint) throw new Error("Checkpoint not found");
    const generation = await FileSystemCommands.generation();
    const workspaceId = WorkspaceService.getCurrent().id;
    if (checkpoint.workspaceId && checkpoint.workspaceId !== workspaceId)
      throw new Error("[agent.recovery_workspace] Reopen the checkpoint workspace first");
    const originals: Array<{ path: string; content: string }> = [];
    for (const file of checkpoint.files) {
      const document = DocumentService.get(file.path);
      const current = document?.content ?? (await FileSystemCommands.readTextFile(file.path));
      if (!(await matchesFingerprint(current, file.afterFingerprint ?? file.fingerprint))) {
        throw new Error(`Checkpoint target changed since capture: ${file.path}`);
      }
      originals.push({ path: file.path, content: current });
    }

    const written: Array<{ path: string; content: string; target: string }> = [];
    const pendingJournal = await AgentStorageIPC.read("journal");
    if (pendingJournal && pendingJournal !== "null")
      throw new Error("[agent.recovery_pending] A previous restore must be recovered first");
    await AgentStorageIPC.write(
      "journal",
      JSON.stringify({
        schema: 1,
        checkpointId: id,
        workspaceId,
        originals,
        targets: checkpoint.files.map(({ path, content }) => ({ path, content })),
      }),
    );
    try {
      for (const [index, file] of checkpoint.files.entries()) {
        written.push({ ...originals[index], target: file.content });
        await writeCompared(file.path, file.content, originals[index].content, generation);
      }
    } catch (cause) {
      // Restore every file whose write may have completed before the failure. Rollback is best
      // effort because the original write error is the actionable failure for the caller.
      const rollbackFailures: string[] = [];
      for (const original of [...written].reverse()) {
        try {
          const current = await readCurrent(original.path);
          if (current !== original.content && current !== original.target)
            throw new Error("[agent.recovery_conflict] Rollback target changed");
          await writeCompared(original.path, original.content, current, generation);
        } catch {
          rollbackFailures.push(original.path);
        }
      }
      if (rollbackFailures.length > 0) {
        throw new AggregateError(
          [cause],
          `Checkpoint restore failed; rollback incomplete for: ${rollbackFailures.join(", ")}`,
        );
      }
      await AgentStorageIPC.write("journal", "null");
      throw cause;
    }
    await AgentStorageIPC.write("journal", "null");
    const activePath = Object.keys(checkpoint.editorViews)[0];
    const view = activePath ? checkpoint.editorViews[activePath] : null;
    if (view && typeof view === "object") {
      EditorAdapter.restoreViewState(view as EditorViewState);
    }
  }

  async deleteForTask(taskId: string): Promise<void> {
    return exclusive(() => this.deleteInternal(taskId));
  }

  private async deleteInternal(taskId: string): Promise<void> {
    await this.initialize();
    const journal = await AgentStorageIPC.read("journal");
    if (journal && journal !== "null")
      throw new Error(
        "[agent.recovery_pending] Recovery data is protected while a restore is unfinished",
      );
    const next = this.checkpoints.filter((checkpoint) => checkpoint.taskId !== taskId);
    await this.persist(next);
    this.checkpoints = next;
  }

  async recoverPendingRestore(): Promise<void> {
    return exclusive(() => this.recoverInternal());
  }

  async hasPendingRestore(): Promise<boolean> {
    const raw = await AgentStorageIPC.read("journal");
    return Boolean(raw && raw !== "null");
  }

  private async recoverInternal(): Promise<void> {
    await this.initialize();
    const raw = await AgentStorageIPC.read("journal");
    if (!raw || raw === "null") return;
    const journal = decodeJournal(raw);
    if (journal.workspaceId !== WorkspaceService.getCurrent().id)
      throw new Error("[agent.recovery_workspace] Reopen the recovery workspace first");
    const generation = await FileSystemCommands.generation();
    for (const [index, original] of journal.originals.entries()) {
      const current =
        DocumentService.get(original.path)?.content ??
        (await FileSystemCommands.readTextFile(original.path));
      if (current !== original.content && current !== journal.targets[index].content)
        throw new Error(`[agent.recovery_conflict] Recovery target changed: ${original.path}`);
    }
    for (let index = journal.originals.length - 1; index >= 0; index--) {
      const original = journal.originals[index];
      const current = await readCurrent(original.path);
      if (current !== original.content && current !== journal.targets[index].content)
        throw new Error(`[agent.recovery_conflict] Recovery target changed: ${original.path}`);
      await writeCompared(original.path, original.content, current, generation);
    }
    await AgentStorageIPC.write("journal", "null");
  }
}

export {
  CORRUPT_STORAGE_PREFIX as AGENT_CHECKPOINT_CORRUPT_STORAGE_PREFIX,
  fingerprint as fingerprintAgentContent,
  STAGING_STORAGE_KEY as AGENT_CHECKPOINT_STAGING_STORAGE_KEY,
  STORAGE_KEY as AGENT_CHECKPOINT_STORAGE_KEY,
};
