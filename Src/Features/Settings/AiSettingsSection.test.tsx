import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProfile, AiProfileDraft, UserConfig } from "../../Foundation/Types/Config";

const mocks = vi.hoisted(() => ({
  config: {} as UserConfig,
  get: vi.fn(),
  persist: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  testConnection: vi.fn(),
  abort: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  sync: vi.fn(async () => undefined),
  toast: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("../../Foundation/I18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("../../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: {
    get: mocks.get,
    update: async (updater: (config: UserConfig) => Partial<UserConfig>) => {
      const patch = updater(mocks.config);
      await mocks.persist(patch);
      mocks.config = { ...mocks.config, ...patch };
      return mocks.config;
    },
  },
}));
vi.mock("../../Core/Agent/AgentService", () => ({
  AgentService: { refreshConfig: mocks.refresh },
}));
vi.mock("../AiAssistant/AgentToolExecutor", () => ({ syncAgentExecutorRegistration: mocks.sync }));
vi.mock("../../Foundation/IPC/AiCommands", () => ({
  AiIPC: {
    saveProfile: mocks.saveProfile,
    deleteProfile: mocks.deleteProfile,
    testResponsesConnection: mocks.testConnection,
    responsesAbort: mocks.abort,
  },
}));
vi.mock("../../UI/Core/ViewState", () => ({ useViewLease: vi.fn() }));
vi.mock("../../UI/Feedback/Toast", () => ({ showToast: mocks.toast, showConfirm: mocks.confirm }));
vi.mock("../../UI/Components/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
}));

import { AiSettingsSection } from "./AiSettingsSection";

function profile(id: string): AiProfile {
  return {
    id,
    name: id,
    baseUrl: "https://example.com/v1",
    provider: "custom",
    model: "model",
    protocol: "responses",
    credentialId: `key-${id}`,
    hasCredential: true,
  };
}
const control = () => screen.getByRole("switch", { name: "ai.settingsEnabledTitle" });
async function open() {
  render(<AiSettingsSection />);
  await waitFor(() => expect(control()).toBeEnabled());
}
function edit() {
  fireEvent.click(screen.getByRole("button", { name: "ai.profileEdit: first" }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("AI settings persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config = {
      ai: { profiles: [profile("first"), profile("second")], activeProfileId: "first" },
    };
    mocks.get.mockImplementation(async () => mocks.config);
    mocks.persist.mockResolvedValue(undefined);
    mocks.saveProfile.mockImplementation(async ({ apiKey: _key, ...draft }: AiProfileDraft) => ({
      ...draft,
      credentialId: "updated-key",
      hasCredential: true,
    }));
    mocks.deleteProfile.mockResolvedValue(undefined);
    mocks.testConnection.mockResolvedValue(200);
    mocks.refresh.mockResolvedValue(undefined);
  });
  afterEach(() => {
    const cancel = screen.queryByRole("button", { name: "common.cancel" });
    if (cancel) fireEvent.click(cancel);
    cleanup();
  });

  it("disables editing until the initial configuration is available", async () => {
    const load = deferred<UserConfig>();
    mocks.get.mockReturnValueOnce(load.promise);
    render(<AiSettingsSection />);
    expect(control()).toBeDisabled();
    fireEvent.click(control());
    expect(mocks.persist).not.toHaveBeenCalled();
    await act(async () => load.resolve(mocks.config));
    await waitFor(() => expect(control()).toBeEnabled());
  });

  it("keeps saved switch values on failure and blocks overlapping edits", async () => {
    const save = deferred<void>();
    mocks.persist.mockReturnValueOnce(save.promise);
    await open();
    fireEvent.click(control());
    expect(control()).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "ai.agent.settingsTitle" }));
    expect(mocks.persist).toHaveBeenCalledOnce();
    await act(async () => save.resolve());
    await waitFor(() => expect(control()).toBeEnabled());
    expect(control()).not.toBeChecked();
    mocks.persist.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(control());
    await waitFor(() => expect(control()).toBeEnabled());
    expect(control()).not.toBeChecked();
    expect(mocks.toast).toHaveBeenLastCalledWith("ai.errorGeneric", "error");
  });

  it("does not claim activation succeeded when the configuration write fails", async () => {
    await open();
    mocks.persist.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(screen.getByRole("button", { name: /second model/ }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("ai.errorGeneric", "error"));
    expect(screen.getByRole("button", { name: /first model/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(mocks.toast).not.toHaveBeenCalledWith("ai.profileActivated", "success");
  });

  it("retains the draft and updated credential reference for a failed save retry", async () => {
    await open();
    edit();
    fireEvent.change(screen.getByRole("textbox", { name: "ai.profileName" }), {
      target: { value: "Revised" },
    });
    fireEvent.change(screen.getByLabelText("ai.profileApiKey"), {
      target: { value: "new-secret" },
    });
    mocks.persist.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "ai.profileName" })).toHaveValue("Revised");
    expect(screen.getByLabelText("ai.profileApiKey")).toHaveValue("");
    expect(mocks.toast).not.toHaveBeenCalledWith("ai.profileSaved", "success");
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.saveProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ credentialId: "updated-key", apiKey: "", name: "Revised" }),
    );
    expect(mocks.config.ai?.profiles?.[0].name).toBe("Revised");
  });

  it("saves against the latest profile list and prevents double submission", async () => {
    await open();
    edit();
    const backend = deferred<AiProfile>();
    mocks.saveProfile.mockReturnValueOnce(backend.promise);
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    expect(mocks.saveProfile).toHaveBeenCalledOnce();
    mocks.config = {
      ai: {
        ...mocks.config.ai,
        profiles: [...(mocks.config.ai?.profiles ?? []), profile("external")],
        activeProfileId: "external",
        agentAutoCheckpoint: false,
      },
    };
    await act(async () => backend.resolve({ ...profile("first"), name: "Saved" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.config.ai?.profiles?.map((item) => item.id)).toEqual([
      "first",
      "second",
      "external",
    ]);
    expect(mocks.config.ai?.activeProfileId).toBe("external");
    expect(mocks.config.ai?.agentAutoCheckpoint).toBe(false);
  });

  it("reconciles a committed setting if refreshing the runtime fails", async () => {
    await open();
    mocks.refresh.mockRejectedValueOnce(new Error("refresh failed"));
    fireEvent.click(control());
    await waitFor(() => expect(control()).toBeEnabled());
    expect(control()).not.toBeChecked();
    expect(mocks.config.ai?.enabled).toBe(false);
  });

  it("catches delete failures and allows retry without a false success", async () => {
    await open();
    mocks.persist.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(screen.getByRole("button", { name: "ai.profileDelete: first" }));
    await act(async () => mocks.confirm.mock.calls[0][0].onConfirm());
    expect(mocks.toast).not.toHaveBeenCalledWith("ai.profileDeleted", "success");
    expect(screen.getByRole("button", { name: "ai.profileDelete: first" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ai.profileDelete: first" }));
    await act(async () => mocks.confirm.mock.calls[1][0].onConfirm());
    expect(mocks.config.ai?.profiles?.map((item) => item.id)).toEqual(["second"]);
    expect(mocks.config.ai?.activeProfileId).toBe("second");
  });

  it("does not let a canceled connection test change a newer editor test", async () => {
    await open();
    edit();
    const oldTest = deferred<number>();
    const newTest = deferred<number>();
    mocks.testConnection.mockReturnValueOnce(oldTest.promise).mockReturnValueOnce(newTest.promise);
    fireEvent.click(screen.getByRole("button", { name: "ai.profileTestConnection" }));
    await waitFor(() => expect(mocks.testConnection).toHaveBeenCalledOnce());
    expect(screen.getByRole("textbox", { name: "ai.profileName" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    edit();
    fireEvent.click(screen.getByRole("button", { name: "ai.profileTestConnection" }));
    await waitFor(() => expect(mocks.testConnection).toHaveBeenCalledTimes(2));
    await act(async () => oldTest.resolve(401));
    expect(screen.getByText("ai.profileTesting")).toBeInTheDocument();
    expect(screen.queryByText("ai.profileTestAuth")).not.toBeInTheDocument();
    await act(async () => newTest.resolve(200));
    expect(screen.getByText("ai.profileTestOk")).toBeInTheDocument();
  });
});
