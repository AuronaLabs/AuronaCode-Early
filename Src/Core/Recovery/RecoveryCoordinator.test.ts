import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

vi.mock("./RecoveryStore", () => ({ RecoveryStore: mocks }));

import { RecoveryCoordinator } from "./RecoveryCoordinator";

describe("RecoveryCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    RecoveryCoordinator.resetForTests();
  });

  afterEach(() => {
    RecoveryCoordinator.resetForTests();
    vi.useRealTimers();
  });

  it("debounces every content change and persists the latest text", async () => {
    RecoveryCoordinator.update("demo.ts", "a", "disk-1", true);
    await vi.advanceTimersByTimeAsync(1_500);
    RecoveryCoordinator.update("demo.ts", "ab", "disk-1", true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(mocks.save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith("demo.ts", "ab", "disk-1");
  });

  it("flushes the latest dirty document immediately", async () => {
    RecoveryCoordinator.update("demo.ts", "latest", "disk-2", true);
    await RecoveryCoordinator.flushAll();

    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith("demo.ts", "latest", "disk-2");
  });

  it("discard cancels the pending write before removing the snapshot", async () => {
    RecoveryCoordinator.update("demo.ts", "discarded", "disk-3", true);
    await RecoveryCoordinator.discard("demo.ts");
    await vi.runAllTimersAsync();

    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith("demo.ts");
  });
});
