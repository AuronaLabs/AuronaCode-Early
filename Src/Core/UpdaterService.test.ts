import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  clear: vi.fn(),
  getConfig: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("../Foundation/Desktop", () => ({
  desktopUpdater: { check: mocks.check, clear: mocks.clear },
}));
vi.mock("../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: { get: mocks.getConfig },
}));
vi.mock("../Foundation/EventBus", () => ({ EventBus: { emit: mocks.emit } }));
vi.mock("../Foundation/Logger", () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));

import { buildUpdateCheckOptions, UpdaterService } from "./UpdaterService";

describe("update checks from the configured release source", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getConfig.mockResolvedValue({});
    UpdaterService.currentUpdate = null;
  });

  it("announces an Alpha update without a separate channel preference", async () => {
    const update = { currentVersion: "0.5.0-alpha.1", version: "0.5.0-alpha.2" };
    mocks.check.mockResolvedValue(update);

    await expect(UpdaterService.checkForUpdates()).resolves.toEqual({
      status: "available",
      update,
    });

    expect(UpdaterService.currentUpdate).toEqual(update);
    expect(mocks.emit).toHaveBeenCalledWith("app:update-available", update);
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it("clears a previous candidate when the source reports no update", async () => {
    UpdaterService.currentUpdate = {
      currentVersion: "0.5.0-alpha.1",
      version: "0.5.0-alpha.2",
    };
    mocks.check.mockResolvedValue(null);

    await expect(UpdaterService.checkForUpdates()).resolves.toEqual({ status: "up-to-date" });

    expect(UpdaterService.currentUpdate).toBeNull();
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe("buildUpdateCheckOptions", () => {
  it("passes the proxy only in custom mode with a proxy url", () => {
    expect(
      buildUpdateCheckOptions({ proxyMode: "custom", proxyUrl: "http://127.0.0.1:7897" }),
    ).toEqual({ proxy: "http://127.0.0.1:7897" });
  });

  it("ignores a custom mode without a proxy url", () => {
    expect(buildUpdateCheckOptions({ proxyMode: "custom" })).toBeUndefined();
    expect(buildUpdateCheckOptions({ proxyMode: "custom", proxyUrl: "" })).toBeUndefined();
  });

  it("follows system defaults for non-custom modes", () => {
    expect(buildUpdateCheckOptions({ proxyMode: "system", proxyUrl: "http://x" })).toBeUndefined();
    expect(buildUpdateCheckOptions({ proxyMode: "direct" })).toBeUndefined();
    expect(buildUpdateCheckOptions({})).toBeUndefined();
  });

  it("tolerates missing network preferences", () => {
    expect(buildUpdateCheckOptions(undefined)).toBeUndefined();
  });
});
