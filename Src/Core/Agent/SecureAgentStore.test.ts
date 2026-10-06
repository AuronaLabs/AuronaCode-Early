const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../../Foundation/IPC/AgentStorageCommands", () => ({ AgentStorageIPC: mocks }));

import { SecureAgentStore } from "./SecureAgentStore";

describe("Secure Agent storage migration", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.read.mockReset();
    mocks.write.mockReset();
  });
  it("removes legacy data only after backend verification", async () => {
    localStorage.setItem("legacy", "[]");
    mocks.read.mockResolvedValueOnce(null).mockResolvedValueOnce("[]");
    await new SecureAgentStore("checkpoints").load(["legacy"], () => true);
    expect(mocks.write).toHaveBeenCalledWith("checkpoints", "[]");
    expect(localStorage.getItem("legacy")).toBeNull();
  });
  it("retains legacy data when the keyring or verification fails", async () => {
    localStorage.setItem("legacy", "[]");
    mocks.read.mockResolvedValueOnce(null).mockResolvedValueOnce("changed");
    await expect(new SecureAgentStore("checkpoints").load(["legacy"], () => true)).rejects.toThrow(
      "verification",
    );
    expect(localStorage.getItem("legacy")).toBe("[]");
    mocks.read.mockRejectedValueOnce(new Error("keyring unavailable"));
    await expect(new SecureAgentStore("checkpoints").load(["legacy"], () => true)).rejects.toThrow(
      "keyring",
    );
    expect(localStorage.getItem("legacy")).toBe("[]");
  });
  it("coalesces history writes and reports persistence failure at flush", async () => {
    mocks.read.mockResolvedValue(null);
    const store = new SecureAgentStore("sessions");
    await store.load([], () => true);
    for (let index = 0; index < 100; index++) store.schedule(String(index));
    await store.flush();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledWith("sessions", "99");
    mocks.write.mockRejectedValueOnce(new Error("disk full"));
    store.schedule("100");
    await expect(store.flush()).rejects.toThrow("disk full");
  });

  it("bounds slow storage to one active write and the latest pending snapshot", async () => {
    vi.useFakeTimers();
    try {
      mocks.read.mockResolvedValue(null);
      const store = new SecureAgentStore("sessions");
      await store.load([], () => true);
      let release: () => void = () => undefined;
      mocks.write.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      store.schedule("first");
      await vi.advanceTimersByTimeAsync(100);
      for (let index = 0; index < 1000; index++) {
        store.schedule(String(index));
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(mocks.write).toHaveBeenCalledTimes(1);
      release();
      await store.flush();
      expect(mocks.write).toHaveBeenCalledTimes(2);
      expect(mocks.write).toHaveBeenLastCalledWith("sessions", "999");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains a divergent staging snapshot during migration", async () => {
    localStorage.setItem("primary", "primary data");
    localStorage.setItem("stage", "newer pending data");
    mocks.read.mockResolvedValueOnce(null).mockResolvedValueOnce("primary data");
    await new SecureAgentStore("sessions").load(["primary", "stage"], () => true);
    expect(localStorage.getItem("primary")).toBeNull();
    expect(localStorage.getItem("stage")).toBe("newer pending data");
  });
});
