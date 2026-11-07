import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SourceControlCache } from "../../../Core/Git";

const mocks = vi.hoisted(() => ({
  root: "C:/first",
  caches: new Map<string, SourceControlCache>(),
  refresh: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  cancel: vi.fn(),
  toast: vi.fn(),
  output: vi.fn(),
  openTab: vi.fn(),
  subscribers: new Set<(cache: SourceControlCache | null) => void>(),
}));
vi.mock("../../../Core/Git", () => ({
  GitService: {
    getCache: (path: string) => mocks.caches.get(path),
    refresh: mocks.refresh,
    commit: mocks.commit,
    push: mocks.push,
    cancel: mocks.cancel,
    subscribe: (listener: (cache: SourceControlCache | null) => void) => {
      mocks.subscribers.add(listener);
      return () => mocks.subscribers.delete(listener);
    },
  },
  isGitCancellation: (error: unknown) => String(error).includes("[git.cancelled]"),
}));
vi.mock("../../../Core/Workspace", () => ({
  WorkspaceService: {
    whenInitialized: () => Promise.resolve(),
    getCurrent: () => ({ primaryRoot: mocks.root }),
  },
}));
vi.mock("../../../Core/OutputService", () => ({ OutputService: { append: mocks.output } }));
vi.mock("../../../Foundation/I18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("../../../UI/Feedback/Toast", () => ({ showToast: mocks.toast }));
vi.mock("../../../State/Workbench/useWorkbenchStore", () => ({
  useWorkbenchStore: { getState: () => ({ openTab: mocks.openTab }) },
}));

import { EventBus } from "../../../Foundation/EventBus";
import { useSourceControl } from "./useSourceControl";

function cache(path: string): SourceControlCache {
  return {
    repoPath: path,
    isRepo: true,
    files: [
      {
        path: "a.ts",
        name: "a.ts",
        status: "M",
        is_staged: true,
        is_conflict: false,
        is_untracked: false,
      },
    ],
    commits: [],
    branch: "feature/first",
    branches: [],
    hasRemote: true,
    ahead: 3,
    behind: 2,
    checkedAt: 1,
  };
}

describe("source control panel ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.root = "C:/first";
    mocks.caches.clear();
    mocks.refresh.mockReset().mockImplementation(async (path: string) => cache(path));
    mocks.commit.mockReset().mockResolvedValue(undefined);
    mocks.push.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("clears branch, remote, dialogs and changes when a new repository cannot be read", async () => {
    const hook = renderHook(useSourceControl);
    await waitFor(() => expect(hook.result.current.branch).toBe("feature/first"));
    act(() => {
      hook.result.current.setIsCreateBranchOpen(true);
      hook.result.current.setNewBranchName("old draft");
    });
    mocks.refresh.mockRejectedValueOnce(new Error("access denied"));
    act(() => EventBus.emit("workspace:root-changed", "C:/second"));
    await waitFor(() => expect(hook.result.current.statusError).toBe("access denied"));
    expect(hook.result.current).toMatchObject({
      repoPath: "C:/second",
      isRepo: false,
      branch: "",
      branches: [],
      hasRemote: false,
      ahead: 0,
      behind: 0,
      files: [],
      commits: [],
      isCreateBranchOpen: false,
      newBranchName: "",
    });
    await act(async () => hook.result.current.fetchStatus("C:/second"));
    expect(hook.result.current.statusError).toBeNull();
    expect(hook.result.current.isRepo).toBe(true);
  });

  it("ignores a status response from a previous workspace", async () => {
    let finish!: (value: SourceControlCache) => void;
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = renderHook(useSourceControl);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith("C:/first"));
    act(() => EventBus.emit("workspace:root-changed", "C:/second"));
    await waitFor(() => expect(hook.result.current.repoPath).toBe("C:/second"));
    await act(async () => finish(cache("C:/first")));
    expect(hook.result.current.repoPath).toBe("C:/second");
  });

  it("serializes repeated writes immediately and preserves a draft edited during commit", async () => {
    let finish!: () => void;
    mocks.commit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const hook = renderHook(useSourceControl);
    await waitFor(() => expect(hook.result.current.files).toHaveLength(1));
    act(() => hook.result.current.setCommitMsg("first message"));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.handleCommit();
      void hook.result.current.handleCommit();
    });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.setCommitMsg("next message"));
    await act(async () => {
      finish();
      await pending;
    });
    expect(hook.result.current.commitMsg).toBe("next message");
    expect(hook.result.current.gitAction).toBeNull();
  });

  it("does not report explicit cancellation as a repository failure", async () => {
    mocks.push.mockRejectedValueOnce(new Error("[git.cancelled] Cancelled"));
    const hook = renderHook(useSourceControl);
    await waitFor(() => expect(hook.result.current.isRepo).toBe(true));
    await act(async () => hook.result.current.runRepositoryAction("push", "Push"));
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(hook.result.current.gitAction).toBeNull();
  });

  it("does not let an old action clear a new workspace action or show its success", async () => {
    const finishes: (() => void)[] = [];
    mocks.push.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishes.push(resolve);
        }),
    );
    const hook = renderHook(useSourceControl);
    await waitFor(() => expect(hook.result.current.isRepo).toBe(true));
    let old!: Promise<void>;
    act(() => {
      old = hook.result.current.runRepositoryAction("push", "First");
    });
    act(() => EventBus.emit("workspace:root-changed", "C:/second"));
    await waitFor(() => expect(hook.result.current.isRepo).toBe(true));
    let next!: Promise<void>;
    act(() => {
      next = hook.result.current.runRepositoryAction("push", "Second");
    });
    await act(async () => {
      finishes[0]();
      await old;
    });
    expect(hook.result.current.gitAction).toBe("push");
    expect(mocks.toast).not.toHaveBeenCalled();
    await act(async () => {
      finishes[1]();
      await next;
    });
    expect(hook.result.current.gitAction).toBeNull();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  it("releases panel subscriptions across twenty mounts without cancelling shared work", async () => {
    for (let cycle = 0; cycle < 20; cycle++) {
      const hook = renderHook(useSourceControl);
      await waitFor(() => expect(hook.result.current.isRepo).toBe(true));
      expect(mocks.subscribers.size).toBe(1);
      hook.unmount();
      expect(mocks.subscribers.size).toBe(0);
    }
    expect(mocks.cancel).not.toHaveBeenCalled();
    const calls = mocks.refresh.mock.calls.length;
    act(() => EventBus.emit("workspace:root-changed", "C:/third"));
    expect(mocks.refresh).toHaveBeenCalledTimes(calls);
  });
});
