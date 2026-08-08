import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountAuthStatus } from "../../Foundation/IPC/AccountAuthCommands";

const mocks = vi.hoisted(() => ({
  status: null as AccountAuthStatus | null,
  login: vi.fn<() => Promise<AccountAuthStatus>>(),
  cancelLogin: vi.fn<() => Promise<AccountAuthStatus>>(),
  logout: vi.fn<() => Promise<AccountAuthStatus>>(),
}));

vi.mock("../../Core/AccountService", () => ({
  AccountService: {
    subscribe: () => () => undefined,
    getSnapshot: () => mocks.status,
    login: mocks.login,
    cancelLogin: mocks.cancelLogin,
    logout: mocks.logout,
  },
}));

import { AccountSettings } from "./AccountSettings";

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

describe("AccountSettings", () => {
  beforeEach(() => {
    mocks.status = signedOut;
    mocks.login.mockReset();
    mocks.cancelLogin.mockReset();
    mocks.logout.mockReset();
  });

  it("starts the official account login from the signed-out page", async () => {
    mocks.login.mockResolvedValue(signedOut);
    render(<AccountSettings />);

    fireEvent.click(screen.getByRole("button", { name: "登录 Aurona Account" }));

    await waitFor(() => expect(mocks.login).toHaveBeenCalledOnce());
  });

  it("shows the authorized profile and keeps logout at the bottom", async () => {
    mocks.status = {
      ...signedOut,
      phase: "signedIn",
      profile: {
        subject: "account-user-id",
        name: "Aurona User",
        preferredUsername: "Aurona",
        email: "user@aurona.cc",
        emailVerified: true,
        picture: null,
      },
    };
    mocks.logout.mockResolvedValue(signedOut);
    render(<AccountSettings />);

    expect(screen.getByRole("heading", { name: "Aurona" })).toBeInTheDocument();
    expect(screen.getByText("@Aurona")).toBeInTheDocument();
    expect(screen.getAllByText("user@aurona.cc").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
  });
});
