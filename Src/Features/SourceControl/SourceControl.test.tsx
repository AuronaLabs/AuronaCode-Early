import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remote: true,
  action: null as string | null,
  run: vi.fn(),
  recovery: vi.fn(),
  create: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../../Foundation/I18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("./hooks/useSourceControl", () => ({
  useSourceControl: () => ({
    repoPath: "C:/repo",
    isRepo: true,
    files: [],
    commits: [],
    commitMsg: "",
    setCommitMsg: vi.fn(),
    isLoading: false,
    isRefreshing: false,
    statusError: null,
    branch: "main",
    branches: [],
    hasRemote: mocks.remote,
    ahead: 3,
    behind: 2,
    gitAction: mocks.action,
    isCreateBranchOpen: false,
    newBranchName: "",
    recoveries: [],
    recoveryOpen: false,
    discardTarget: null,
    setIsCreateBranchOpen: mocks.create,
    runRepositoryAction: mocks.run,
    runRecoveryAction: mocks.recovery,
    fetchStatus: mocks.refresh,
  }),
}));

import { SourceControl } from "./SourceControl";

async function more() {
  await userEvent.click(screen.getByRole("button", { name: "sourceControl.moreActions" }));
}

describe("Git more menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    mocks.remote = true;
    mocks.action = null;
  });
  afterEach(cleanup);

  it("keeps repository commands in one keyboard-accessible menu without Preview", async () => {
    render(<SourceControl />);
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
    expect(screen.queryByText("sourceControl.createBranch")).not.toBeInTheDocument();
    expect(screen.queryByText("sourceControl.fetchUpdates")).not.toBeInTheDocument();
    await more();
    expect(screen.getByRole("menuitem", { name: "sourceControl.createBranch" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "sourceControl.pull 2" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "sourceControl.push 3" })).toBeEnabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sourceControl.moreActions" })).toHaveFocus();
  });

  it.each([
    ["sourceControl.fetchUpdates", "fetch", "Fetch"],
    ["sourceControl.pull 2", "pull", "Pull"],
    ["sourceControl.push 3", "push", "Push"],
  ])("runs %s from More", async (name, action, label) => {
    render(<SourceControl />);
    await more();
    fireEvent.click(screen.getByRole("menuitem", { name }));
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(action, label);
  });

  it("opens branch creation and recovery from More", async () => {
    render(<SourceControl />);
    await more();
    fireEvent.click(screen.getByRole("menuitem", { name: "sourceControl.createBranch" }));
    expect(mocks.create).toHaveBeenCalledWith(true);
    await more();
    fireEvent.click(screen.getByRole("menuitem", { name: "sourceControl.recoveryRecords" }));
    expect(mocks.recovery).toHaveBeenCalledWith("list");
  });

  it("disables remote actions when no remote is configured", async () => {
    mocks.remote = false;
    render(<SourceControl />);
    await more();
    expect(screen.getByRole("menuitem", { name: "sourceControl.fetchUpdates" })).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByRole("menuitem", { name: "sourceControl.pull 2" })).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByRole("menuitem", { name: "sourceControl.push 3" })).toHaveAttribute(
      "data-disabled",
    );
    expect(
      screen.getByRole("menuitem", { name: "sourceControl.createBranch" }),
    ).not.toHaveAttribute("data-disabled");
  });

  it("prevents overlapping repository operations", async () => {
    mocks.action = "Fetch";
    render(<SourceControl />);
    await more();
    for (const item of screen.getAllByRole("menuitem"))
      expect(item).toHaveAttribute("data-disabled");
  });
});
