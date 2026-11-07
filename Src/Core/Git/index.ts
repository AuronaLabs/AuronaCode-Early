import {
  type GitBranch,
  type GitCommit,
  type GitFile,
  type GitFullStatus,
  GitIPC,
} from "../../Foundation/IPC/GitCommands";
import { OutputService } from "../OutputService";
import { WorkspaceService } from "../Workspace";

export type {
  GitBranch,
  GitCommit,
  GitFile,
  GitFullStatus,
  GitRecovery,
} from "../../Foundation/IPC/GitCommands";

export type SourceControlCache = {
  repoPath: string | null;
  isRepo: boolean;
  files: GitFile[];
  commits: GitCommit[];
  branch: string;
  branches: GitBranch[];
  hasRemote: boolean;
  ahead: number;
  behind: number;
  checkedAt: number;
};

export function isGitCancellation(error: unknown): boolean {
  return /\[(?:process\.cancelled|git\.cancelled|workspace\.generation)\]/.test(String(error));
}

function toCache(repoPath: string, status: GitFullStatus): SourceControlCache {
  return {
    repoPath,
    isRepo: status.is_repo,
    files: status.files,
    commits: status.commits,
    branch: status.branch,
    branches: status.branches,
    hasRemote: status.has_remote,
    ahead: status.ahead,
    behind: status.behind,
    checkedAt: Date.now(),
  };
}

type CacheListener = (cache: SourceControlCache | null) => void;

/** Owns repository queries and invalidation; views never cancel another consumer's request. */
class GitServiceImpl {
  private cache: SourceControlCache | null = null;
  private readonly caches = new Map<string, SourceControlCache>();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Set<CacheListener>();
  private readonly inflightRefresh = new Map<string, Promise<SourceControlCache | null>>();
  private readonly inflightDiffs = new Map<string, Promise<string>>();
  private generation = 0;
  private owners = 0;
  private stopWorkspace: (() => void) | undefined;

  start(): () => void {
    if (this.owners++ === 0) {
      let workspaceId = WorkspaceService.getCurrent().id;
      this.stopWorkspace = WorkspaceService.subscribe((workspace) => {
        if (workspace.id === workspaceId) return;
        workspaceId = workspace.id;
        this.clearCache();
      });
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (--this.owners === 0) {
        this.stopWorkspace?.();
        this.stopWorkspace = undefined;
        this.clearCache();
      }
    };
  }

  getCache(path: string | null): SourceControlCache | null {
    return path ? (this.caches.get(path) ?? null) : null;
  }

  setCache(cache: SourceControlCache): void {
    if (cache.repoPath) this.caches.set(cache.repoPath, cache);
    this.cache = cache;
    this.emit();
  }

  clearCache(): void {
    this.generation++;
    this.revisions.clear();
    this.inflightRefresh.clear();
    this.inflightDiffs.clear();
    this.caches.clear();
    this.cache = null;
    this.emit();
  }

  subscribe(listener: CacheListener): () => void {
    this.listeners.add(listener);
    listener(this.cache);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.cache);
      } catch (error) {
        console.error("Git cache listener failed", error);
      }
    }
  }

  private context(path: string): string {
    return `${this.generation}\u0000${this.revisions.get(path) ?? 0}\u0000${path}`;
  }

  private invalidate(path: string): void {
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
    this.caches.delete(path);
    if (this.cache?.repoPath === path) {
      this.cache = null;
      this.emit();
    }
  }

  refresh(path: string): Promise<SourceControlCache | null> {
    const key = this.context(path);
    const existing = this.inflightRefresh.get(key);
    if (existing) return existing;
    const refresh = (async () => {
      try {
        const status = await GitIPC.getFullStatus(path);
        if (this.context(path) !== key) return null;
        const cache = toCache(path, status);
        this.setCache(cache);
        return cache;
      } catch (error) {
        if (this.context(path) !== key) return null;
        throw error;
      } finally {
        this.inflightRefresh.delete(key);
      }
    })();
    this.inflightRefresh.set(key, refresh);
    return refresh;
  }

  async getFullStatus(path: string): Promise<GitFullStatus> {
    const cache = await this.refresh(path);
    if (!cache) throw new Error("[workspace.generation] Workspace changed");
    return {
      repo_path: path,
      is_repo: cache.isRepo,
      files: cache.files,
      commits: cache.commits,
      branch: cache.branch,
      branches: cache.branches,
      has_remote: cache.hasRemote,
      ahead: cache.ahead,
      behind: cache.behind,
    };
  }

  private async query<T>(path: string, work: () => Promise<T>): Promise<T> {
    const context = this.context(path);
    const value = await work();
    if (this.context(path) !== context) throw new Error("[workspace.generation] Workspace changed");
    return value;
  }

  private async mutate<T>(path: string, work: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    this.invalidate(path);
    let result: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      result = { ok: true, value: await work() };
    } catch (error) {
      result = { ok: false, error };
    }
    if (this.generation === generation) {
      this.invalidate(path);
      try {
        await this.refresh(path);
      } catch (error) {
        OutputService.append(
          "source-control",
          `Git operation ${result.ok ? "completed" : "failed"}; status refresh failed: ${String(error)}`,
          "warn",
        );
      }
    }
    if (!result.ok) throw result.error;
    return result.value;
  }

  init(path: string) {
    return this.mutate(path, () => GitIPC.init(path));
  }
  stage(path: string, file: string) {
    return this.mutate(path, () => GitIPC.add(path, file));
  }
  stageAll(path: string, files: string[]) {
    return this.mutate(path, async () => {
      for (const file of files) await GitIPC.add(path, file);
    });
  }
  unstage(path: string, file: string) {
    return this.mutate(path, () => GitIPC.unstage(path, file));
  }
  unstageAll(path: string) {
    return this.mutate(path, () => GitIPC.unstageAll(path));
  }
  discardFile(path: string, file: string) {
    return this.mutate(path, () => GitIPC.discardFile(path, file));
  }
  discardAll(path: string) {
    return this.mutate(path, () => GitIPC.discardAll(path));
  }
  restoreDiscard(path: string, hash: string) {
    return this.mutate(path, () => GitIPC.restoreDiscard(path, hash));
  }
  commit(path: string, message: string) {
    return this.mutate(path, () => GitIPC.commit(path, message));
  }
  switchBranch(path: string, branch: string) {
    return this.mutate(path, () => GitIPC.switchBranch(path, branch));
  }
  createBranch(path: string, branch: string) {
    return this.mutate(path, () => GitIPC.createBranch(path, branch));
  }
  fetch(path: string) {
    return this.mutate(path, () => GitIPC.fetch(path));
  }
  pull(path: string) {
    return this.mutate(path, () => GitIPC.pull(path));
  }
  push(path: string) {
    return this.mutate(path, () => GitIPC.push(path));
  }
  setRemote(path: string, url: string) {
    return this.mutate(path, () => GitIPC.setRemote(path, url));
  }
  applyHunk(path: string, file: string, staged: boolean, index: number, diff: string) {
    return this.mutate(path, () => GitIPC.applyHunk(path, file, staged, index, diff));
  }
  getRemote(path: string) {
    return this.query(path, () => GitIPC.getRemote(path));
  }
  listDiscardRecoveries(path: string) {
    return this.query(path, () => GitIPC.listDiscardRecoveries(path));
  }
  getCommitDiff(path: string, hash: string) {
    return this.query(path, () => GitIPC.getCommitDiff(path, hash));
  }
  async checkIsRepo(path: string) {
    return (await this.getFullStatus(path)).is_repo;
  }
  async getLog(path: string) {
    return (await this.getFullStatus(path)).commits;
  }
  async listBranches(path: string) {
    return (await this.getFullStatus(path)).branches;
  }
  async cancel(path: string): Promise<void> {
    await GitIPC.cancel(path);
    this.invalidate(path);
  }

  getDiff(path: string, file: string, staged = false): Promise<string> {
    const key = `${this.context(path)}\u0000${file}\u0000${staged}`;
    const inflight = this.inflightDiffs.get(key);
    if (inflight) return inflight;
    const promise = this.query(path, () => GitIPC.getWorktreeDiff(path, file, staged)).finally(
      () => {
        this.inflightDiffs.delete(key);
      },
    );
    this.inflightDiffs.set(key, promise);
    return promise;
  }

  getDiffCached(path: string, file: string): Promise<string> {
    return this.getDiff(path, file);
  }
}

export const GitService = new GitServiceImpl();
