import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exists: vi.fn(async () => false),
  read: vi.fn(async () => "{}"),
  write: vi.fn<(file: string, text: string, options: unknown) => Promise<void>>(
    async () => undefined,
  ),
  error: vi.fn(),
}));

vi.mock("../Desktop/FileSystem", () => ({
  BaseDirectory: { AppLocalData: "app-local-data" },
  desktopFileSystem: {
    exists: mocks.exists,
    mkdir: vi.fn(async () => undefined),
    readTextFile: mocks.read,
    writeTextFileAtomic: mocks.write,
  },
}));
vi.mock("../Logger", () => ({ Logger: { error: mocks.error, warn: vi.fn() } }));

import { WorkspaceStore } from "./WorkspaceStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("WorkspaceStore persistence", () => {
  beforeEach(() => {
    WorkspaceStore.resetCache();
    mocks.exists.mockResolvedValue(false);
    mocks.read.mockResolvedValue("{}");
    mocks.write.mockResolvedValue(undefined);
    vi.useFakeTimers();
  });
  afterEach(async () => {
    await WorkspaceStore.flush().catch(() => undefined);
    WorkspaceStore.resetCache();
    vi.useRealTimers();
  });

  it("merges concurrent changes against the latest in-memory state", async () => {
    await Promise.all([
      WorkspaceStore.set({ lastOpenedPath: "/workspace" }),
      WorkspaceStore.set({ activeTabId: "tab" }),
      WorkspaceStore.set({ sidebarWidth: 320 }),
    ]);
    await WorkspaceStore.flush();
    const snapshot = JSON.parse(mocks.write.mock.calls.at(-1)?.[1] ?? "{}");
    expect(snapshot).toEqual({
      lastOpenedPath: "/workspace",
      activeTabId: "tab",
      sidebarWidth: 320,
    });
    expect(mocks.exists).toHaveBeenCalledTimes(1);
  });

  it("flush waits for state updates that are still loading their initial snapshot", async () => {
    const reading = deferred<boolean>();
    mocks.exists.mockReturnValueOnce(reading.promise);
    const mutation = WorkspaceStore.set({ lastOpenedPath: "/workspace" });
    let finished = false;
    const flushing = WorkspaceStore.flush().then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    const premature = finished;
    reading.resolve(false);
    await Promise.all([mutation, flushing]);
    expect(premature).toBe(false);
    expect(JSON.parse(mocks.write.mock.calls.at(-1)?.[1] ?? "{}").lastOpenedPath).toBe(
      "/workspace",
    );
  });

  it("debounces changes and avoids rewriting clean snapshots", async () => {
    await WorkspaceStore.set({ activeTabId: "first" });
    await vi.advanceTimersByTimeAsync(250);
    await WorkspaceStore.set({ activeTabId: "second" });
    await vi.advanceTimersByTimeAsync(499);
    expect(mocks.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await WorkspaceStore.flush();
    await WorkspaceStore.flush();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.write.mock.calls[0][1]).activeTabId).toBe("second");
  });

  it("reports a background write failure to flush and retries the unsaved snapshot", async () => {
    mocks.write.mockRejectedValueOnce(new Error("disk full"));
    await WorkspaceStore.set({ lastOpenedPath: "/workspace" });
    await vi.advanceTimersByTimeAsync(500);
    // A failed background write must still reach the close guard, not be hidden by logging.
    mocks.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(WorkspaceStore.flush()).rejects.toThrow("disk full");
    await WorkspaceStore.flush();
    expect(JSON.parse(mocks.write.mock.calls.at(-1)?.[1] ?? "{}").lastOpenedPath).toBe(
      "/workspace",
    );
    expect(mocks.error).toHaveBeenCalled();
  });

  it("keeps newer changes dirty while an earlier snapshot is being written", async () => {
    const write = deferred<void>();
    mocks.write.mockReturnValueOnce(write.promise);
    await WorkspaceStore.set({ activeTabId: "first" });
    await vi.advanceTimersByTimeAsync(500);
    await WorkspaceStore.set({ activeTabId: "second" });
    write.resolve();
    await WorkspaceStore.flush();
    expect(JSON.parse(mocks.write.mock.calls.at(-1)?.[1] ?? "{}").activeTabId).toBe("second");
  });

  it("serializes writes and does not lose changes after a failed write", async () => {
    mocks.write.mockRejectedValueOnce(new Error("read only"));
    await WorkspaceStore.set({ lastOpenedPath: "/workspace" });
    await expect(WorkspaceStore.flush()).rejects.toThrow("read only");
    await WorkspaceStore.set({ activeTabId: "tab" });
    await WorkspaceStore.flush();
    expect(JSON.parse(mocks.write.mock.calls.at(-1)?.[1] ?? "{}")).toEqual({
      lastOpenedPath: "/workspace",
      activeTabId: "tab",
    });
  });

  it("rejects old reads after a cache reset without replacing the new state", async () => {
    const exists = deferred<boolean>();
    mocks.exists.mockReturnValueOnce(exists.promise);
    const old = WorkspaceStore.get();
    const rejected = expect(old).rejects.toThrow("reset");
    await vi.advanceTimersByTimeAsync(0);
    WorkspaceStore.resetCache();
    await WorkspaceStore.set({ lastOpenedPath: "/new" });
    exists.resolve(true);
    await rejected;
    expect(await WorkspaceStore.get()).toEqual({ lastOpenedPath: "/new" });
  });

  it("does not detach an in-flight disk write when the cache is reset", async () => {
    const write = deferred<void>();
    mocks.write.mockReturnValueOnce(write.promise);
    await WorkspaceStore.set({ lastOpenedPath: "/old" });
    await vi.advanceTimersByTimeAsync(500);
    WorkspaceStore.resetCache();
    let finished = false;
    const next = WorkspaceStore.get().then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    write.resolve();
    await next;
    expect(finished).toBe(true);
  });

  it.each(["null", "[]", "42"])("uses defaults for invalid root state %s", async (source) => {
    mocks.exists.mockResolvedValue(true);
    mocks.read.mockResolvedValue(source);
    expect(await WorkspaceStore.get()).toEqual({});
    expect(mocks.error).toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
