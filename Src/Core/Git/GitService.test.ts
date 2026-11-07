const mocks = vi.hoisted(() => ({
  fullStatus: vi.fn(),
  diff: vi.fn(),
  add: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));
vi.mock("../../Foundation/IPC/GitCommands", () => ({
  GitIPC: { getFullStatus: mocks.fullStatus, getWorktreeDiff: mocks.diff, add: mocks.add },
}));
vi.mock("../Workspace", () => ({
  WorkspaceService: { getCurrent: () => ({ id: "test" }), subscribe: mocks.subscribe },
}));

import { GitService } from "./index";

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
  it("invalidates a status request started before a write", async () => {
    let complete: (value: ReturnType<typeof status>) => void = () => undefined;
    mocks.fullStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const old = GitService.refresh("repo");
    mocks.add.mockResolvedValue(undefined);
    mocks.fullStatus.mockResolvedValueOnce({ ...status("repo"), branch: "after-write" });
    await GitService.stage("repo", "file");
    complete({ ...status("repo"), branch: "before-write" });
    expect(await old).toBeNull();
    expect(GitService.getCache("repo")?.branch).toBe("after-write");
  });

  it("retains independent repository caches", async () => {
    mocks.fullStatus.mockImplementation(async (path: string) => status(path));
    await GitService.refresh("a");
    await GitService.refresh("b");
    expect(GitService.getCache("a")?.repoPath).toBe("a");
    expect(GitService.getCache("b")?.repoPath).toBe("b");
  });

  it("preserves a successful mutation when its status refresh fails", async () => {
    mocks.add.mockResolvedValueOnce(undefined);
    mocks.fullStatus.mockRejectedValueOnce(new Error("status offline"));
    await expect(GitService.stage("repo", "file")).resolves.toBeUndefined();
    expect(GitService.getCache("repo")).toBeNull();
  });

  it("refreshes after failed mutations while preserving the original error", async () => {
    mocks.add.mockRejectedValueOnce(new Error("write rejected"));
    mocks.fullStatus.mockResolvedValueOnce(status("repo"));
    await expect(GitService.stage("repo", "file")).rejects.toThrow("write rejected");
    expect(GitService.getCache("repo")?.branch).toBe("main");
  });

  it("releases the workspace listener once during 20 start/stop cycles", () => {
    mocks.subscribe.mockClear();
    for (let cycle = 0; cycle < 20; cycle++) {
      const dispose = GitService.start();
      const nested = GitService.start();
      dispose();
      dispose();
      nested();
      nested();
    }
    expect(mocks.subscribe).toHaveBeenCalledTimes(20);
    for (const result of mocks.subscribe.mock.results) expect(result.value).toHaveBeenCalledOnce();
  });
});
