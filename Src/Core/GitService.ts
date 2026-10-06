import {
  type GitBranch,
  type GitCommit,
  type GitFile,
  GitIPC,
} from "../Foundation/IPC/GitCommands";
import { WorkspaceService } from "./WorkspaceService";

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

function toCache(
  repoPath: string,
  status: Awaited<ReturnType<typeof GitIPC.getFullStatus>>,
): SourceControlCache {
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

/**
 * Git 服务：统一封装 GitIPC 命令并维护工作区级缓存。
 * 写操作（stage/unstage/commit 等）完成后自动刷新缓存并通知订阅者。
 */
class GitServiceImpl {
  private cache: SourceControlCache | null = null;
  private readonly listeners = new Set<CacheListener>();
  private readonly inflightRefresh = new Map<string, Promise<SourceControlCache | null>>();
  private readonly inflightDiffs = new Map<string, Promise<string>>();
  private generation = 0;

  constructor() {
    let workspaceId = WorkspaceService.getCurrent().id;
    WorkspaceService.subscribe((workspace) => {
      if (workspace.id === workspaceId) return;
      workspaceId = workspace.id;
      this.clearCache();
    });
  }

  public getCache(path: string | null): SourceControlCache | null {
    if (!path || !this.cache || this.cache.repoPath !== path) return null;
    return this.cache;
  }

  public setCache(cache: SourceControlCache) {
    this.cache = cache;
    this.emit();
  }

  public clearCache() {
    this.generation++;
    this.inflightRefresh.clear();
    this.inflightDiffs.clear();
    this.cache = null;
    this.emit();
  }

  public subscribe(listener: CacheListener): () => void {
    this.listeners.add(listener);
    listener(this.cache);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((listener) => {
      listener(this.cache);
    });
  }

  /**
   * 拉取仓库全量状态并写入缓存。并发调用会合并为一次请求。
   */
  public async refresh(path: string): Promise<SourceControlCache | null> {
    const generation = this.generation;
    const key = `${generation}\u0000${path}`;
    const existing = this.inflightRefresh.get(key);
    if (existing) return existing;
    const refresh = (async () => {
      try {
        const status = await GitIPC.getFullStatus(path);
        if (this.generation !== generation) return null;
        const cache = toCache(path, status);
        this.cache = cache;
        this.emit();
        return cache;
      } catch (error) {
        if (this.generation !== generation) return null;
        throw error;
      } finally {
        this.inflightRefresh.delete(key);
      }
    })();
    this.inflightRefresh.set(key, refresh);
    return refresh;
  }

  public async stage(path: string, file: string): Promise<void> {
    await GitIPC.add(path, file);
    await this.refresh(path);
  }

  public async stageAll(path: string, files: string[]): Promise<void> {
    await Promise.all(files.map((file) => GitIPC.add(path, file)));
    await this.refresh(path);
  }

  public async unstage(path: string, file: string): Promise<void> {
    await GitIPC.unstage(path, file);
    await this.refresh(path);
  }

  public async unstageAll(path: string): Promise<void> {
    await GitIPC.unstageAll(path);
    await this.refresh(path);
  }

  public async discardFile(path: string, file: string): Promise<void> {
    await GitIPC.discardFile(path, file);
    await this.refresh(path);
  }

  public async commit(path: string, message: string): Promise<void> {
    await GitIPC.commit(path, message);
    await this.refresh(path);
  }

  public async getDiff(path: string, file: string, staged = false): Promise<string> {
    return GitIPC.getWorktreeDiff(path, file, staged);
  }

  /** 并发合并的单文件 diff：同一文件同时多次请求只发一次 IPC */
  public getDiffCached(path: string, file: string): Promise<string> {
    const generation = this.generation;
    const key = `${generation}\u0000${path}\u0000${file}`;
    const inflight = this.inflightDiffs.get(key);
    if (inflight) return inflight;
    const promise = GitIPC.getWorktreeDiff(path, file, false)
      .then((diff) => {
        if (this.generation !== generation)
          throw new Error("[workspace.generation] Workspace changed");
        return diff;
      })
      .finally(() => {
        this.inflightDiffs.delete(key);
      });
    this.inflightDiffs.set(key, promise);
    return promise;
  }

  public async getLog(path: string): Promise<GitCommit[]> {
    return GitIPC.getLog(path);
  }

  public async listBranches(path: string): Promise<GitBranch[]> {
    const cached = this.getCache(path);
    if (cached) return cached.branches;
    const status = await GitIPC.getFullStatus(path);
    return status.branches;
  }

  public async switchBranch(path: string, branch: string): Promise<void> {
    await GitIPC.switchBranch(path, branch);
    await this.refresh(path);
  }
}

export const GitService = new GitServiceImpl();
