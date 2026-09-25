import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFullStatus } from "../../Foundation/IPC/GitCommands";

const mocks = vi.hoisted(() => ({
  checkIsRepo: vi.fn(),
  init: vi.fn(),
  getFullStatus: vi.fn(),
  getRemote: vi.fn(),
  setRemote: vi.fn(),
  fetch: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../Foundation/I18n", () => ({
  useLocale: () => ({
    t: (key: string) =>
      key === "settings.sourceControlSection.remoteReadFailed" ? "Read failed: {message}" : key,
  }),
}));

vi.mock("../../Foundation/EventBus", () => ({
  EventBus: { on: () => () => undefined },
}));

vi.mock("../../Foundation/Storage/WorkspaceStore", () => ({
  WorkspaceStore: {
    getCached: () => ({ lastOpenedPath: "C:/workspace" }),
    init: () => Promise.resolve(),
    get: () => Promise.resolve({ lastOpenedPath: "C:/workspace" }),
  },
}));

vi.mock("../../Foundation/IPC/GitCommands", () => ({
  GitIPC: {
    checkIsRepo: mocks.checkIsRepo,
    init: mocks.init,
    getFullStatus: mocks.getFullStatus,
    getRemote: mocks.getRemote,
    setRemote: mocks.setRemote,
    fetch: mocks.fetch,
  },
}));

vi.mock("../../UI/Feedback/Toast", () => ({ showToast: mocks.showToast }));

import { SourceControlSettingsSection } from "./SourceControlSettingsSection";

const status: GitFullStatus = {
  repo_path: "C:/workspace",
  is_repo: true,
  branch: "main",
  branches: [{ name: "main", is_current: true }],
  files: [
    {
      path: "a.ts",
      name: "a.ts",
      status: "M",
      is_staged: true,
      is_conflict: false,
      is_untracked: false,
    },
    {
      path: "b.ts",
      name: "b.ts",
      status: "M",
      is_staged: false,
      is_conflict: false,
      is_untracked: false,
    },
  ],
  commits: [],
  has_remote: false,
  ahead: 0,
  behind: 0,
};

describe("SourceControlSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkIsRepo.mockResolvedValue(true);
    mocks.init.mockResolvedValue(undefined);
    mocks.getFullStatus.mockResolvedValue(status);
    mocks.getRemote.mockResolvedValue("");
    mocks.setRemote.mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("shows the repository state and enables fetch after saving origin", async () => {
    mocks.getRemote.mockResolvedValueOnce("").mockResolvedValue("https://example.com/repo.git");
    render(<SourceControlSettingsSection />);

    await screen.findByText("settings.sourceControlSection.remoteMissing");
    expect(screen.getByText("main")).toBeInTheDocument();
    const fetchButton = screen.getByRole("button", { name: "sourceControl.fetchUpdates" });
    expect(fetchButton).toBeDisabled();

    fireEvent.change(
      screen.getByRole("textbox", { name: "settings.sourceControlSection.remoteUrl" }),
      { target: { value: "https://example.com/repo.git" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "settings.sourceControlSection.apply" }));

    await waitFor(() =>
      expect(mocks.setRemote).toHaveBeenCalledWith("C:/workspace", "https://example.com/repo.git"),
    );
    await waitFor(() => expect(fetchButton).toBeEnabled());
    fireEvent.click(fetchButton);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("C:/workspace"));
  });

  it("reports an origin read error instead of treating it as an absent remote", async () => {
    mocks.getRemote.mockRejectedValue(new Error("invalid remote config"));
    render(<SourceControlSettingsSection />);

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("invalid remote config");
    expect(
      screen.queryByText("settings.sourceControlSection.remoteMissing"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sourceControl.fetchUpdates" })).toBeDisabled();
  });

  it("initializes an open folder and then loads its Git state", async () => {
    mocks.checkIsRepo.mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<SourceControlSettingsSection />);

    const initButton = await screen.findByRole("button", { name: "sourceControl.initRepository" });
    fireEvent.click(initButton);

    await waitFor(() => expect(mocks.init).toHaveBeenCalledWith("C:/workspace"));
    await screen.findByText("main");
  });
});
