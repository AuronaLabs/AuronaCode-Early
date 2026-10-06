import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exists: vi.fn(), migrate: vi.fn(), write: vi.fn() }));
vi.mock("../Desktop", () => ({
  BaseDirectory: { AppLocalData: 1 },
  desktopFileSystem: { exists: mocks.exists, mkdir: vi.fn(), writeTextFileAtomic: mocks.write },
}));
vi.mock("../IPC/AiCommands", () => ({ AiIPC: { migrateUserConfig: mocks.migrate } }));
vi.mock("../Logger", () => ({ Logger: { warn: vi.fn(), error: vi.fn() } }));

import { UserConfigStore } from "./UserConfigStore";

describe("UserConfigStore credential migration and persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    UserConfigStore.resetCache();
    mocks.exists.mockResolvedValue(true);
    mocks.migrate.mockResolvedValue({ locale: "ja" });
    mocks.write.mockResolvedValue(undefined);
  });

  it("keeps failed migration retryable and never overwrites the original configuration", async () => {
    mocks.migrate.mockRejectedValue(new Error("keyring unavailable"));
    await expect(UserConfigStore.get()).rejects.toThrow("keyring unavailable");
    await expect(UserConfigStore.set({ locale: "en" })).rejects.toThrow("keyring unavailable");
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.migrate.mockResolvedValue({ locale: "ja" });
    await expect(UserConfigStore.get()).resolves.toEqual({ locale: "ja" });
    await UserConfigStore.set({ locale: "en" });
    expect(JSON.parse(mocks.write.mock.calls[0][1])).toEqual({ locale: "en" });
  });

  it("rejects plaintext credentials before reading or writing configuration", async () => {
    await expect(UserConfigStore.set({ ai: { apiKey: "secret" } })).rejects.toThrow("Credentials");
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("shares the initial migration and serializes concurrent updates without dropping fields", async () => {
    let release!: () => void;
    mocks.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = UserConfigStore.set({ locale: "en" });
    const second = UserConfigStore.set({
      marketplaceServerUrl: "https://marketplace.aurona.cc/api",
    });
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    expect(mocks.migrate).toHaveBeenCalledOnce();
    release();
    await Promise.all([first, second]);
    expect(JSON.parse(mocks.write.mock.calls[1][1])).toEqual({
      locale: "en",
      marketplaceServerUrl: "https://marketplace.aurona.cc/api",
    });
  });

  it("reports failed writes to set and flush and allows a later write to recover", async () => {
    mocks.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(UserConfigStore.set({ locale: "en" })).rejects.toThrow("disk full");
    await expect(UserConfigStore.flush()).rejects.toThrow("disk full");
    await UserConfigStore.set({ locale: "de" });
    await expect(UserConfigStore.flush()).resolves.toBeUndefined();
    expect(JSON.parse(mocks.write.mock.calls[1][1]).locale).toBe("de");
  });

  it("isolates an old migration from a cache reset and a newer load", async () => {
    let release!: (value: { locale: string }) => void;
    mocks.migrate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = UserConfigStore.get();
    const rejected = expect(old).rejects.toThrow("cache was reset");
    await vi.waitFor(() => expect(mocks.migrate).toHaveBeenCalledOnce());
    UserConfigStore.resetCache();
    mocks.migrate.mockResolvedValue({ locale: "de" });
    await expect(UserConfigStore.get()).resolves.toEqual({ locale: "de" });
    release({ locale: "ja" });
    await rejected;
    await expect(UserConfigStore.get()).resolves.toEqual({ locale: "de" });
  });
});
