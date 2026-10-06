const mocks = vi.hoisted(() => ({ fullStatus: vi.fn(), diff: vi.fn() }));
vi.mock("../Foundation/IPC/GitCommands", () => ({
  GitIPC: { getFullStatus: mocks.fullStatus, getWorktreeDiff: mocks.diff },
}));
vi.mock("./WorkspaceService", () => ({
  WorkspaceService: { getCurrent: () => ({ id: "test" }), subscribe: () => () => undefined },
}));

import { GitService } from "./GitService";

const status = (path: string) => ({
  repo_path: path,
  is_repo: true,
  files: [],
  commits: [],
  branch: "main",
  branches: [],
  has_remote: false,
  ahead: 0,
  behind: 0,
});

describe("Git refresh isolation", () => {
  beforeEach(() => {
    GitService.clearCache();
    mocks.fullStatus.mockReset();
    mocks.diff.mockReset();
  });
  it("deduplicates one repository while allowing independent repository requests", async () => {
    const pending = new Map<string, (value: ReturnType<typeof status>) => void>();
    mocks.fullStatus.mockImplementation(
      (path: string) => new Promise((resolve) => pending.set(path, resolve)),
    );
    const a = GitService.refresh("a");
    const duplicate = GitService.refresh("a");
    const b = GitService.refresh("b");
    expect(mocks.fullStatus).toHaveBeenCalledTimes(2);
    pending.get("a")?.(status("a"));
    pending.get("b")?.(status("b"));
    expect((await a)?.repoPath).toBe("a");
    expect((await duplicate)?.repoPath).toBe("a");
    expect((await b)?.repoPath).toBe("b");
  });
  it("prevents a revoked request from overwriting a newer workspace cache", async () => {
    let old: (value: ReturnType<typeof status>) => void = () => undefined;
    mocks.fullStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    );
    const pending = GitService.refresh("old");
    GitService.clearCache();
    mocks.fullStatus.mockResolvedValueOnce(status("new"));
    await GitService.refresh("new");
    old(status("old"));
    expect(await pending).toBeNull();
    expect(GitService.getCache("new")?.repoPath).toBe("new");
  });
  it("reports current failures rather than returning an old successful status", async () => {
    mocks.fullStatus.mockResolvedValueOnce(status("repo"));
    await GitService.refresh("repo");
    mocks.fullStatus.mockRejectedValueOnce(new Error("[git.cancelled] Cancelled"));
    await expect(GitService.refresh("repo")).rejects.toThrow("Cancelled");
  });
  it("isolates a stale diff from a new request for the same path", async () => {
    let complete: (diff: string) => void = () => undefined;
    mocks.diff.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const old = GitService.getDiffCached("repo", "file");
    const rejected = expect(old).rejects.toThrow("Workspace changed");
    GitService.clearCache();
    mocks.diff.mockResolvedValueOnce("new");
    const current = GitService.getDiffCached("repo", "file");
    complete("old");
    await rejected;
    expect(await current).toBe("new");
    expect(mocks.diff).toHaveBeenCalledTimes(2);
  });
});
