import type { GitCommit, GitFile } from "../Foundation/IPC/GitCommands";

export type SourceControlCache = {
  repoPath: string | null;
  isRepo: boolean;
  files: GitFile[];
  commits: GitCommit[];
  branch: string;
  checkedAt: number;
};

class GitServiceImpl {
  private cache: SourceControlCache | null = null;

  public getCache(path: string | null): SourceControlCache | null {
    if (!path || !this.cache || this.cache.repoPath !== path) return null;
    return this.cache;
  }

  public setCache(cache: SourceControlCache) {
    this.cache = cache;
  }

  public clearCache() {
    this.cache = null;
  }
}

export const GitService = new GitServiceImpl();
