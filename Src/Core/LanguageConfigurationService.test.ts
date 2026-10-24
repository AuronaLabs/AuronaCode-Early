const state = vi.hoisted(() => ({
  root: "C:/project",
  trusted: false,
  config: { security: { autoTrustWorkspaceLanguageServers: false } } as {
    trustedWorkspaceRoots?: string[];
    security?: { autoTrustWorkspaceLanguageServers?: boolean };
  },
  emit: vi.fn(),
}));

vi.mock("../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: {
    get: vi.fn(async () => state.config),
  },
}));

vi.mock("./FileSystemService", () => ({
  FileSystemService: {
    joinPath: (...parts: string[]) => parts.join("/"),
    exists: vi.fn(async () => true),
    readTextFile: vi.fn(async () =>
      JSON.stringify({ languages: { typescript: { server: { command: "project-lsp" } } } }),
    ),
  },
}));

vi.mock("./WorkspaceService", () => ({
  WorkspaceService: {
    getCurrent: () => ({ primaryRoot: state.root }),
    setTrusted: (trusted: boolean) => {
      state.trusted = trusted;
    },
  },
}));

vi.mock("../Foundation/EventBus", () => ({
  EventBus: {
    emit: state.emit,
  },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageConfigurationService } from "./LanguageConfigurationService";

describe("workspace language-service trust preference", () => {
  beforeEach(() => {
    state.root = "C:/project";
    state.trusted = false;
    state.config = { security: { autoTrustWorkspaceLanguageServers: false } };
    state.emit.mockClear();
  });

  it("keeps per-workspace approval as the default", async () => {
    await expect(LanguageConfigurationService.resolve("typescript")).rejects.toMatchObject({
      name: "WorkspaceTrustRequiredError",
    });
    expect(state.emit).toHaveBeenCalledWith("workspace:trust-request", {
      root: "C:/project",
      language: "typescript",
    });
  });

  it("uses workspace configuration without prompting when auto-trust is enabled", async () => {
    state.config = { security: { autoTrustWorkspaceLanguageServers: true } };

    await expect(LanguageConfigurationService.checkWorkspaceTrust()).resolves.toBe(false);
    await expect(LanguageConfigurationService.resolve("typescript")).resolves.toMatchObject({
      command: "project-lsp",
    });
    expect(state.trusted).toBe(true);
    expect(state.emit).not.toHaveBeenCalled();
  });

  it("honors a previously approved workspace when auto-trust is disabled", async () => {
    state.config = {
      trustedWorkspaceRoots: ["c:/project"],
      security: { autoTrustWorkspaceLanguageServers: false },
    };

    await expect(LanguageConfigurationService.resolve("typescript")).resolves.toMatchObject({
      command: "project-lsp",
    });
    expect(state.trusted).toBe(true);
    expect(state.emit).not.toHaveBeenCalled();
  });
  it("clears a pending prompt after enabling auto-trust without permanently approving the workspace", async () => {
    await LanguageConfigurationService.checkWorkspaceTrust();
    state.config.security = { autoTrustWorkspaceLanguageServers: true };
    await LanguageConfigurationService.checkWorkspaceTrust();
    state.emit.mockClear();
    LanguageConfigurationService.flushPendingTrustRequest();
    expect(state.emit).not.toHaveBeenCalled();
    expect(state.config.trustedWorkspaceRoots).toBeUndefined();
    state.config.security.autoTrustWorkspaceLanguageServers = false;
    await expect(LanguageConfigurationService.resolve("typescript")).rejects.toMatchObject({
      name: "WorkspaceTrustRequiredError",
    });
    expect(state.trusted).toBe(false);
  });
});
