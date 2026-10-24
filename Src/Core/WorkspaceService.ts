import { FileSystemCommands } from "../Foundation/IPC/FileSystemCommands";
import { PlatformService } from "../Foundation/Platform";
import { WorkspaceStore } from "../Foundation/Storage/WorkspaceStore";

export type WorkspaceMode = "singleFile" | "workspace";

export interface WorkspaceDescriptor {
  id: string;
  mode: WorkspaceMode;
  roots: readonly string[];
  primaryRoot: string | null;
  trusted: boolean;
}

type WorkspaceListener = (workspace: WorkspaceDescriptor) => void;

const EMPTY_WORKSPACE: WorkspaceDescriptor = {
  id: "single-file",
  mode: "singleFile",
  roots: [],
  primaryRoot: null,
  trusted: false,
};

const normalize = (path: string) =>
  /^[a-z]:[\\/]$/i.test(path) ? path : path.replace(/[\\/]+$/, "") || "/";

class WorkspaceServiceImpl {
  private current = EMPTY_WORKSPACE;
  private readonly listeners = new Set<WorkspaceListener>();
  private initialization: Promise<void> = Promise.resolve();
  private completeInitialization: (() => void) | null = null;
  private restorePromise: Promise<void> | null = null;

  prepareInitialization(): void {
    if (this.completeInitialization) return;
    this.initialization = new Promise((resolve) => {
      this.completeInitialization = resolve;
    });
  }

  whenInitialized(): Promise<void> {
    return this.initialization;
  }

  async initialize(): Promise<void> {
    if (this.restorePromise) return this.restorePromise;
    this.restorePromise = this.restore();
    try {
      await this.restorePromise;
    } finally {
      this.restorePromise = null;
    }
  }

  async cancelInitialization(): Promise<void> {
    await this.clearBackendRoot();
    this.current = EMPTY_WORKSPACE;
    this.emit();
    this.completeInitialization?.();
    this.completeInitialization = null;
  }

  private async restore(): Promise<void> {
    try {
      const persisted = await WorkspaceStore.get();
      if (persisted.lastOpenedPath) {
        try {
          await this.openRoot(persisted.lastOpenedPath);
        } catch (error) {
          console.warn("Stored workspace could not be restored:", error);
          this.current = EMPTY_WORKSPACE;
          this.emit();
          if (String(error).includes("[workspace.root]")) {
            await WorkspaceStore.set({ lastOpenedPath: undefined });
          }
          await this.clearBackendRoot();
        }
      } else {
        await this.clearBackendRoot();
      }
    } finally {
      this.completeInitialization?.();
      this.completeInitialization = null;
    }
  }

  getCurrent(): WorkspaceDescriptor {
    return this.current;
  }

  subscribe(listener: WorkspaceListener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  async openRoot(path: string): Promise<void> {
    const root = normalize(path);
    await FileSystemCommands.setWorkspaceRoot(root);
    this.setRoot(path, false);
    await WorkspaceStore.set({ lastOpenedPath: this.current.primaryRoot ?? undefined });
  }

  async close(): Promise<void> {
    await this.clearBackendRoot();
    this.current = EMPTY_WORKSPACE;
    await WorkspaceStore.set({ lastOpenedPath: undefined });
    this.emit();
  }

  private async clearBackendRoot(): Promise<void> {
    try {
      await FileSystemCommands.setWorkspaceRoot(null);
    } catch (error) {
      console.warn("Failed to clear the desktop workspace session:", error);
    }
  }

  setTrusted(trusted: boolean): void {
    if (this.current.trusted === trusted) return;
    this.current = { ...this.current, trusted };
    this.emit();
  }

  private setRoot(path: string, trusted: boolean): void {
    const root = normalize(path);
    this.current = {
      id: `workspace:${PlatformService.current() === "windows" ? root.replace(/\\/g, "/").toLowerCase() : root}`,
      mode: "workspace",
      roots: [root],
      primaryRoot: root,
      trusted,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}

export const WorkspaceService = new WorkspaceServiceImpl();
