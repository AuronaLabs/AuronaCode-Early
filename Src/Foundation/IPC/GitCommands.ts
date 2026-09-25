import { invokeDesktop } from "../Desktop";

export interface GitFile {
  path: string;
  name: string;
  status: string;
  is_staged: boolean;
  is_conflict: boolean;
  is_untracked: boolean;
}

export interface GitCommit {
  hash: string;
  author: string;
  message: string;
  date: string;
}

export interface GitBranch {
  name: string;
  is_current: boolean;
}

export interface GitFullStatus {
  repo_path: string;
  is_repo: boolean;
  files: GitFile[];
  commits: GitCommit[];
  branch: string;
  branches: GitBranch[];
  has_remote: boolean;
  ahead: number;
  behind: number;
}

export const GitIPC = {
  checkIsRepo: (path: string) => invokeDesktop<boolean>("git_check_is_repo", { path }),

  init: (path: string) => invokeDesktop<void>("git_init", { path }),

  getStatus: (path: string) => invokeDesktop<GitFile[]>("git_status", { path }),

  add: (path: string, file: string) => invokeDesktop<void>("git_add", { path, file }),

  unstage: (path: string, file: string) => invokeDesktop<void>("git_unstage", { path, file }),

  commit: (path: string, message: string) => invokeDesktop<void>("git_commit", { path, message }),

  getCurrentBranch: (path: string) => invokeDesktop<string>("git_current_branch", { path }),

  push: (path: string) => invokeDesktop<void>("git_push", { path }),

  pull: (path: string) => invokeDesktop<void>("git_pull", { path }),

  fetch: (path: string) => invokeDesktop<void>("git_fetch", { path }),

  switchBranch: (path: string, branch: string) =>
    invokeDesktop<void>("git_switch_branch", { path, branch }),

  createBranch: (path: string, branch: string) =>
    invokeDesktop<void>("git_create_branch", { path, branch }),

  getWorktreeDiff: (path: string, file: string, staged: boolean) =>
    invokeDesktop<string>("git_worktree_diff", { path, file, staged }),

  applyHunk: (
    path: string,
    file: string,
    staged: boolean,
    hunkIndex: number,
    expectedDiff: string,
  ) => invokeDesktop<void>("git_apply_hunk", { path, file, staged, hunkIndex, expectedDiff }),

  discardFile: (path: string, file: string) =>
    invokeDesktop<void>("git_discard_file", { path, file }),

  discardAll: (path: string) => invokeDesktop<void>("git_discard_all", { path }),

  unstageAll: (path: string) => invokeDesktop<void>("git_unstage_all", { path }),

  getRemote: (path: string) => invokeDesktop<string>("git_get_remote", { path }),

  setRemote: (path: string, url: string) => invokeDesktop<void>("git_set_remote", { path, url }),

  getLog: (path: string) => invokeDesktop<GitCommit[]>("git_log", { path }),

  getCommitDiff: (path: string, hash: string) =>
    invokeDesktop<string>("git_diff_commit", { path, hash }),

  getFullStatus: (path: string) => invokeDesktop<GitFullStatus>("git_get_full_status", { path }),
};
