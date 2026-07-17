import { invokeDesktop } from "../Desktop";

export interface GitFile {
  path: string;
  name: string;
  status: string;
  is_staged: boolean;
}

export interface GitCommit {
  hash: string;
  author: string;
  message: string;
  date: string;
}

export interface GitFullStatus {
  repo_path: string;
  is_repo: boolean;
  files: GitFile[];
  commits: GitCommit[];
  branch: string;
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

  discardAll: (path: string) => invokeDesktop<void>("git_discard_all", { path }),

  unstageAll: (path: string) => invokeDesktop<void>("git_unstage_all", { path }),

  getRemote: (path: string) => invokeDesktop<string>("git_get_remote", { path }),

  setRemote: (path: string, url: string) => invokeDesktop<void>("git_set_remote", { path, url }),

  getLog: (path: string) => invokeDesktop<GitCommit[]>("git_log", { path }),

  getFullStatus: (path: string) => invokeDesktop<GitFullStatus>("git_get_full_status", { path }),
};
