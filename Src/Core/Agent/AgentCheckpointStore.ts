import { FileSystemCommands } from "../../Foundation/IPC/FileSystemCommands";
import type { EditorViewState } from "../../Foundation/Types/Editor";
import { DocumentService } from "../DocumentService";
import { EditorAdapter } from "../Editor/EditorAdapter";
import type { AgentCheckpoint } from "./AgentTypes";

const STORAGE_KEY = "aurona.ai.agent.checkpoints.v1";
const STAGING_STORAGE_KEY = `${STORAGE_KEY}.staging`;
const CORRUPT_STORAGE_PREFIX = `${STORAGE_KEY}.corrupt.`;
const CHECKPOINT_LIMIT = 40;
const CORRUPT_BACKUP_LIMIT = 3;

function fingerprint(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
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
      typeof file.fingerprint === "string",
  );
  if (files.length !== raw.files.length) return null;
  return {
    id: raw.id,
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
    // A full or unavailable storage must not prevent in-memory checkpoint use.
  }
}

function readStored(): AgentCheckpoint[] {
  const read = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const primaryRaw = read(STORAGE_KEY);
  const primary = decode(primaryRaw);
  if (primary) return primary;
  if (primaryRaw) rememberCorrupt(primaryRaw);
  const stagingRaw = read(STAGING_STORAGE_KEY);
  const staging = decode(stagingRaw);
  if (staging) {
    writeStored(staging);
    return staging;
  }
  if (stagingRaw) rememberCorrupt(stagingRaw);
  return [];
}

function writeStored(checkpoints: AgentCheckpoint[]): void {
  const serialized = JSON.stringify(checkpoints.slice(0, CHECKPOINT_LIMIT));
  try {
    // Stage and validate before promotion so a failed write cannot destroy the previous list.
    localStorage.setItem(STAGING_STORAGE_KEY, serialized);
    if (localStorage.getItem(STAGING_STORAGE_KEY) !== serialized) return;
    if (!decode(serialized)) return;
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.removeItem(STAGING_STORAGE_KEY);
  } catch {
    // Checkpoints are best effort; the active task remains usable in memory.
  }
}

export class AgentCheckpointStore {
  private checkpoints = readStored();

  async capture(taskId: string, paths: string[], reason: string): Promise<AgentCheckpoint> {
    const uniquePaths = [...new Set(paths.filter((path) => path.trim() !== ""))];
    const files: AgentCheckpoint["files"] = [];
    for (const path of uniquePaths) {
      const document = DocumentService.get(path);
      const content = document?.content ?? (await FileSystemCommands.readTextFile(path));
      files.push({ path, content, fingerprint: fingerprint(content) });
    }
    const status = EditorAdapter.getStatus();
    const view = EditorAdapter.getViewState();
    const checkpoint: AgentCheckpoint = {
      id: createId(),
      taskId,
      createdAt: Date.now(),
      reason,
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
    this.checkpoints = [checkpoint, ...this.checkpoints].slice(0, CHECKPOINT_LIMIT);
    writeStored(this.checkpoints);
    return checkpoint;
  }

  get(id: string): AgentCheckpoint | null {
    return this.checkpoints.find((checkpoint) => checkpoint.id === id) ?? null;
  }

  listForTask(taskId: string): AgentCheckpoint[] {
    return this.checkpoints.filter((checkpoint) => checkpoint.taskId === taskId);
  }

  async restore(id: string): Promise<void> {
    const checkpoint = this.get(id);
    if (!checkpoint) throw new Error("Checkpoint not found");
    const originals: Array<{ path: string; content: string }> = [];
    for (const file of checkpoint.files) {
      const document = DocumentService.get(file.path);
      const current = document?.content ?? (await FileSystemCommands.readTextFile(file.path));
      if (fingerprint(current) !== file.fingerprint) {
        throw new Error(`Checkpoint target changed since capture: ${file.path}`);
      }
      originals.push({ path: file.path, content: current });
    }

    const write = async (path: string, content: string): Promise<void> => {
      const document = DocumentService.get(path);
      if (document?.openState === "open") {
        await DocumentService.applyEdits(
          path,
          [{ startUtf16: 0, endUtf16: document.content.length, text: content }],
          content,
          "external",
        );
      } else {
        await FileSystemCommands.writeTextFile(path, content);
      }
    };

    const written: Array<{ path: string; content: string }> = [];
    try {
      for (const [index, file] of checkpoint.files.entries()) {
        written.push(originals[index]);
        await write(file.path, file.content);
      }
    } catch (cause) {
      // Restore every file whose write may have completed before the failure. Rollback is best
      // effort because the original write error is the actionable failure for the caller.
      for (const original of [...written].reverse()) {
        try {
          await write(original.path, original.content);
        } catch {
          // Keep attempting the remaining files; one unavailable path must not stop rollback.
        }
      }
      throw cause;
    }
    const activePath = Object.keys(checkpoint.editorViews)[0];
    const view = activePath ? checkpoint.editorViews[activePath] : null;
    if (view && typeof view === "object") {
      EditorAdapter.restoreViewState(view as EditorViewState);
    }
  }

  deleteForTask(taskId: string): void {
    this.checkpoints = this.checkpoints.filter((checkpoint) => checkpoint.taskId !== taskId);
    writeStored(this.checkpoints);
  }
}

export {
  CORRUPT_STORAGE_PREFIX as AGENT_CHECKPOINT_CORRUPT_STORAGE_PREFIX,
  fingerprint as fingerprintAgentContent,
  STAGING_STORAGE_KEY as AGENT_CHECKPOINT_STAGING_STORAGE_KEY,
  STORAGE_KEY as AGENT_CHECKPOINT_STORAGE_KEY,
};
