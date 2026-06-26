import { invoke } from "@tauri-apps/api/core";

// Git 命令相关数据结构
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

// 类型安全的 Git IPC 封装层，消灭散落全局的魔法字符串
export const GitIPC = {
  checkIsRepo: (path: string) =>
    invoke<boolean>("git_check_is_repo", { path }),

  init: (path: string) =>
    invoke<void>("git_init", { path }),

  getStatus: (path: string) =>
    invoke<GitFile[]>("git_status", { path }),

  add: (path: string, file: string) =>
    invoke<void>("git_add", { path, file }),

  unstage: (path: string, file: string) =>
    invoke<void>("git_unstage", { path, file }),

  commit: (path: string, message: string) =>
    invoke<void>("git_commit", { path, message }),

  getCurrentBranch: (path: string) =>
    invoke<string>("git_current_branch", { path }),

  push: (path: string) =>
    invoke<void>("git_push", { path }),

  pull: (path: string) =>
    invoke<void>("git_pull", { path }),

  discardAll: (path: string) =>
    invoke<void>("git_discard_all", { path }),

  unstageAll: (path: string) =>
    invoke<void>("git_unstage_all", { path }),

  getRemote: (path: string) =>
    invoke<string>("git_get_remote", { path }),

  setRemote: (path: string, url: string) =>
    invoke<void>("git_set_remote", { path, url }),

  getLog: (path: string) =>
    invoke<GitCommit[]>("git_log", { path }),

  getFullStatus: (path: string) =>
    invoke<GitFullStatus>("git_get_full_status", { path }),
};
