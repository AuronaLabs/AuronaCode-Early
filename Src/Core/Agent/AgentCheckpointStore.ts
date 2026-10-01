import { FileSystemCommands } from "../../Foundation/IPC/FileSystemCommands";
import type { EditorViewState } from "../../Foundation/Types/Editor";
import { DocumentService } from "../DocumentService";
import { EditorAdapter } from "../Editor/EditorAdapter";
import type { AgentCheckpoint } from "./AgentTypes";

const STORAGE_KEY = "aurona.ai.agent.checkpoints.v1";
const CHECKPOINT_LIMIT = 40;

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

function readStored(): AgentCheckpoint[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? (value as AgentCheckpoint[]).slice(0, CHECKPOINT_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeStored(checkpoints: AgentCheckpoint[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checkpoints.slice(0, CHECKPOINT_LIMIT)));
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
    for (const file of checkpoint.files) {
      const document = DocumentService.get(file.path);
      const current = document?.content ?? (await FileSystemCommands.readTextFile(file.path));
      if (fingerprint(current) !== file.fingerprint) {
        throw new Error(`Checkpoint target changed since capture: ${file.path}`);
      }
    }
    for (const file of checkpoint.files) {
      const document = DocumentService.get(file.path);
      if (document?.openState === "open") {
        await DocumentService.applyEdits(
          file.path,
          [{ startUtf16: 0, endUtf16: document.content.length, text: file.content }],
          file.content,
        );
      } else {
        await FileSystemCommands.writeTextFile(file.path, file.content);
      }
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

export { fingerprint as fingerprintAgentContent };
