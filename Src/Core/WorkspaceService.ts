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

const normalize = (path: string) => path.replace(/[\\/]+$/, "");

class WorkspaceServiceImpl {
  private current = EMPTY_WORKSPACE;
  private readonly listeners = new Set<WorkspaceListener>();

  async initialize(): Promise<void> {
    const persisted = await WorkspaceStore.get();
    if (persisted.lastOpenedPath) this.setRoot(persisted.lastOpenedPath, false);
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
    this.setRoot(path, false);
    await WorkspaceStore.set({ lastOpenedPath: this.current.primaryRoot ?? undefined });
  }

  async close(): Promise<void> {
    this.current = EMPTY_WORKSPACE;
    await WorkspaceStore.set({ lastOpenedPath: undefined });
    this.emit();
  }

  setTrusted(trusted: boolean): void {
    if (this.current.trusted === trusted) return;
    this.current = { ...this.current, trusted };
    this.emit();
  }

  private setRoot(path: string, trusted: boolean): void {
    const root = normalize(path);
    this.current = {
      id: `workspace:${root.toLowerCase()}`,
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
