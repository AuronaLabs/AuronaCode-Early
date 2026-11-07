import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountAuthStatus } from "../Foundation/IPC/AccountAuthCommands";

const mocks = vi.hoisted(() => ({
  status: vi.fn<() => Promise<AccountAuthStatus>>(),
  start: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  refresh: vi.fn<() => Promise<AccountAuthStatus>>(),
  restore: vi.fn<() => Promise<AccountAuthStatus>>(),
  logout: vi.fn(async () => undefined),
  shutdown: vi.fn(async () => undefined),
}));

vi.mock("../Foundation/IPC/AccountAuthCommands", () => ({ AccountAuthIPC: mocks }));

import { AccountService } from "./AccountService";

const signedOut: AccountAuthStatus = {
  enabled: true,
  registeredRedirectUri: "http://127.0.0.1/oauth/callback",
  providerIssuer: "https://auth.aurona.cc",
  discoveryUrl: "https://auth.aurona.cc/.well-known/openid-configuration",
  phase: "signedOut",
  profile: null,
  expiresAtUnix: null,
  lastError: null,
  lastNotice: null,
};

const signedIn: AccountAuthStatus = {
  ...signedOut,
  phase: "signedIn",
  profile: {
    subject: "user-1",
    name: "Aurona User",
    preferredUsername: "aurona",
    email: "user@aurona.cc",
    emailVerified: true,
    picture: null,
  },
};

describe("AccountService", () => {
  it("does not restore an expired application session", async () => {
    let finish!: (status: AccountAuthStatus) => void;
    mocks.restore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let active = true;
    const previous = AccountService.getSnapshot();
    const restore = AccountService.initialize(() => active);
    active = false;
    finish(signedIn);
    await restore;
    expect(AccountService.getSnapshot()).toBe(previous);
  });
  it("does not overwrite logout with an older restore", async () => {
    let finish!: (status: AccountAuthStatus) => void;
    mocks.restore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const restore = AccountService.initialize();
    mocks.status.mockResolvedValue(signedOut);
    await AccountService.logout();
    finish(signedIn);
    await restore;
    expect(AccountService.getSnapshot()).toEqual(signedOut);
  });
  beforeEach(() => {
    mocks.status.mockReset();
    mocks.start.mockClear();
    mocks.cancel.mockClear();
    mocks.refresh.mockReset();
    mocks.restore.mockReset();
    mocks.logout.mockClear();
    mocks.shutdown.mockClear();
  });

  it("publishes the restored account status", async () => {
    mocks.restore.mockResolvedValue(signedIn);
    const listener = vi.fn();
    const unsubscribe = AccountService.subscribe(listener);

    await AccountService.initialize();

    expect(AccountService.getSnapshot()).toEqual(signedIn);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("follows the browser authorization until the profile is available", async () => {
    mocks.status
      .mockResolvedValueOnce({ ...signedOut, phase: "awaitingCallback" })
      .mockResolvedValueOnce(signedIn);

    await expect(AccountService.login()).resolves.toEqual(signedIn);

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(AccountService.getSnapshot().profile?.subject).toBe("user-1");
  });

  it("clears the projected profile after logout", async () => {
    mocks.status.mockResolvedValue(signedOut);

    await expect(AccountService.logout()).resolves.toEqual(signedOut);

    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(AccountService.getSnapshot().profile).toBeNull();
  });
});
