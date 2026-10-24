import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserConfig } from "../../Foundation/Types/Config";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  reload: vi.fn(),
  trust: vi.fn(),
  emit: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../../Foundation/I18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("../../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: {
    get: mocks.get,
    update: async (updater: (config: UserConfig) => Partial<UserConfig>) => {
      const current = await mocks.get();
      const patch = updater(current);
      await mocks.set(patch);
      return { ...current, ...patch };
    },
  },
}));
vi.mock("../../Core/Language/LspClient", () => ({
  LspClient: { getInstance: () => ({ reloadConfiguredServers: mocks.reload }) },
}));
vi.mock("../../Core/LanguageConfigurationService", () => ({
  LanguageConfigurationService: { checkWorkspaceTrust: mocks.trust },
}));
vi.mock("../../Foundation/EventBus", () => ({ EventBus: { emit: mocks.emit } }));
vi.mock("../../UI/Feedback/Toast", () => ({ showToast: mocks.toast }));

import { SecuritySettingsSection } from "./SecuritySettingsSection";

const control = (key: string) =>
  screen.getByRole("switch", { name: `settings.securitySettings.${key}` });

async function open(config: UserConfig = {}) {
  mocks.get.mockResolvedValue(config);
  render(<SecuritySettingsSection />);
  await waitFor(() => expect(control("localProcessApproval")).toBeEnabled());
}

describe("Security settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.set.mockResolvedValue(undefined);
    mocks.reload.mockResolvedValue(undefined);
    mocks.trust.mockResolvedValue(false);
  });
  afterEach(cleanup);

  it("defaults to asking for native actions and requiring workspace language-service trust", async () => {
    await open();
    expect(control("autoTrustWorkspace")).not.toBeChecked();
    for (const key of [
      "extensionSignature",
      "catalogSignature",
      "localProcessApproval",
      "workspaceApproval",
      "aiEndpointApproval",
      "packageInstallApproval",
      "extensionExecutionApproval",
      "deleteApproval",
      "gitDiscardApproval",
    ]) {
      expect(control(key)).toBeChecked();
    }
  });

  it("preserves other security preferences and saves independent native switches without restarting servers", async () => {
    await open({
      security: { autoTrustWorkspaceLanguageServers: true, requireDeleteApproval: false },
    });
    fireEvent.click(control("localProcessApproval"));
    await waitFor(() => expect(control("localProcessApproval")).not.toBeChecked());
    expect(mocks.set).toHaveBeenCalledWith({
      security: {
        autoTrustWorkspaceLanguageServers: true,
        requireDeleteApproval: false,
        requireLocalProcessApproval: false,
      },
    });
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(control("deleteApproval")).not.toBeChecked();
  });

  it("rechecks trust and reloads servers when automatic trust changes", async () => {
    await open();
    fireEvent.click(control("autoTrustWorkspace"));
    await waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce());
    expect(mocks.trust).toHaveBeenCalledOnce();
    expect(mocks.emit).toHaveBeenCalledWith("settings:language-changed");
    expect(control("autoTrustWorkspace")).toBeChecked();
  });

  it("keeps the saved value on a write failure and reports it", async () => {
    mocks.set.mockRejectedValueOnce(new Error("disk full"));
    await open();
    fireEvent.click(control("localProcessApproval"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("disk full", "error"));
    expect(control("localProcessApproval")).toBeChecked();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(control("localProcessApproval")).toBeEnabled();
  });

  it("blocks overlapping edits until persistence finishes", async () => {
    let release!: () => void;
    mocks.set.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await open();
    fireEvent.click(control("localProcessApproval"));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledOnce());
    expect(control("deleteApproval")).toBeDisabled();
    fireEvent.click(control("deleteApproval"));
    expect(mocks.set).toHaveBeenCalledOnce();
    release();
    await waitFor(() => expect(control("deleteApproval")).toBeEnabled());
    expect(control("localProcessApproval")).not.toBeChecked();
  });

  it("restores the default using the reset control", async () => {
    await open({ security: { requireDeleteApproval: false } });
    fireEvent.click(
      screen.getByRole("button", { name: "settings.securitySettings.deleteApproval" }),
    );
    await waitFor(() => expect(control("deleteApproval")).toBeChecked());
    expect(mocks.set).toHaveBeenCalledWith({ security: { requireDeleteApproval: true } });
  });

  it("allows package and catalog signature checks to be disabled independently", async () => {
    await open({ security: { requireExtensionCatalogSignature: true } });
    fireEvent.click(control("extensionSignature"));
    await waitFor(() => expect(control("extensionSignature")).not.toBeChecked());
    expect(control("catalogSignature")).toBeChecked();
    expect(mocks.set).toHaveBeenLastCalledWith({
      security: { requireExtensionCatalogSignature: true, requireExtensionSignature: false },
    });
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("reports load errors without allowing unsaved default values to overwrite configuration", async () => {
    mocks.get.mockRejectedValue(new Error("migration unavailable"));
    render(<SecuritySettingsSection />);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("migration unavailable", "error"));
    expect(control("localProcessApproval")).toBeDisabled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
