import {
  type GitBranch,
  type GitCommit,
  type GitFile,
  GitIPC,
} from "../Foundation/IPC/GitCommands";

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
  private inflightRefresh: Promise<SourceControlCache | null> | null = null;

  public getCache(path: string | null): SourceControlCache | null {
    if (!path || !this.cache || this.cache.repoPath !== path) return null;
    return this.cache;
  }

  public setCache(cache: SourceControlCache) {
    this.cache = cache;
    this.emit();
  }

  public clearCache() {
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
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = (async () => {
      try {
        const status = await GitIPC.getFullStatus(path);
        const cache = toCache(path, status);
        this.cache = cache;
        this.emit();
        return cache;
      } catch {
        return this.cache;
      } finally {
        this.inflightRefresh = null;
      }
    })();
    return this.inflightRefresh;
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
