import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorktreeDiff: vi.fn(),
  getCommitDiff: vi.fn(),
  applyHunk: vi.fn(),
  refresh: vi.fn(),
  emit: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../Foundation/I18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("../../Foundation/Storage/WorkspaceStore", () => ({
  WorkspaceStore: { get: () => Promise.resolve({ lastOpenedPath: "C:/workspace" }) },
}));
vi.mock("../../Foundation/IPC/GitCommands", () => ({
  GitIPC: {
    getWorktreeDiff: mocks.getWorktreeDiff,
    getCommitDiff: mocks.getCommitDiff,
    applyHunk: mocks.applyHunk,
  },
}));
vi.mock("../../Core/GitService", () => ({
  GitService: { refresh: mocks.refresh },
}));
vi.mock("../../Foundation/EventBus", () => ({ EventBus: { emit: mocks.emit } }));
vi.mock("../../UI/Feedback/Toast", () => ({ showToast: mocks.showToast }));

import { DiffViewer } from "./DiffViewer";

const textDiff = [
  "diff --git a/main.txt b/main.txt",
  "index 6d5cd1d..28f181a 100644",
  "--- a/main.txt",
  "+++ b/main.txt",
  "@@ -1,3 +1,3 @@",
  " first",
  "-second",
  "+second changed",
  " third",
  "@@ -20,3 +20,3 @@",
  " twentieth",
  "-twenty first",
  "+twenty first changed",
  " twenty second",
  "",
].join("\n");

describe("DiffViewer partial staging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorktreeDiff.mockResolvedValue(textDiff);
    mocks.applyHunk.mockResolvedValue(undefined);
    mocks.refresh.mockResolvedValue({ repoPath: "C:/workspace", files: [] });
  });

  afterEach(cleanup);

  it("stages only the selected text hunk using the diff the user reviewed", async () => {
    render(<DiffViewer diffTarget="working:unstaged:main.txt" />);
    const buttons = await screen.findAllByRole("button", { name: "sourceControl.stageHunk" });
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[1]);

    await waitFor(() =>
      expect(mocks.applyHunk).toHaveBeenCalledWith("C:/workspace", "main.txt", false, 1, textDiff),
    );
    await waitFor(() => expect(mocks.emit).toHaveBeenCalledWith("git:changes-count", 0));
  });

  it("hides hunk actions for file creation diffs", async () => {
    mocks.getWorktreeDiff.mockResolvedValue(
      [
        "diff --git a/new.txt b/new.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/new.txt",
        "@@ -0,0 +1 @@",
        "+new file",
        "",
      ].join("\n"),
    );
    render(<DiffViewer diffTarget="working:staged:new.txt" />);

    await screen.findByText("new file");
    expect(screen.queryByRole("button", { name: "sourceControl.unstageHunk" })).toBeNull();
  });
});
