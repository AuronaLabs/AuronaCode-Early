import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("../../Core/Workspace", () => ({
  WorkspaceService: {
    whenInitialized: async () => {},
    getCurrent: () => ({ primaryRoot: "C:/workspace" }),
  },
}));
vi.mock("../../Core/Git", () => ({
  GitService: {
    refresh: mocks.refresh,
    getDiff: mocks.getWorktreeDiff,
    getCommitDiff: mocks.getCommitDiff,
    applyHunk: mocks.applyHunk,
  },
}));
vi.mock("../../Foundation/EventBus", () => ({
  EventBus: { emit: mocks.emit, on: () => () => {} },
}));
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
    Element.prototype.scrollIntoView = vi.fn();
    mocks.getWorktreeDiff.mockResolvedValue(textDiff);
    mocks.applyHunk.mockResolvedValue(undefined);
    mocks.refresh.mockResolvedValue({ repoPath: "C:/workspace", files: [] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it("pairs replacement rows and supports unified view and wrapping", async () => {
    const { container } = render(<DiffViewer diffTarget="working:unstaged:main.txt" />);
    await screen.findAllByRole("button", { name: "sourceControl.stageHunk" });
    expect(container.querySelectorAll(".diff-code-pane")[0].children).toHaveLength(3);
    expect(container.querySelectorAll(".diff-code-pane")[1].children).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "sourceControl.diffViewer.unified" }));
    expect(container.querySelectorAll(".diff-code--unified")[0].children).toHaveLength(4);
    expect(screen.getAllByText("first")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "sourceControl.diffViewer.wrap" }));
    expect(container.querySelector(".diff-viewer")).toHaveClass("diff-viewer--wrap");
  });

  it("navigates and focuses changes, wrapping back to the first hunk", async () => {
    const { container } = render(<DiffViewer diffTarget="working:unstaged:main.txt" />);
    await screen.findAllByRole("button", { name: "sourceControl.stageHunk" });
    const next = screen.getByRole("button", { name: "sourceControl.diffViewer.nextChange" });
    const hunks = container.querySelectorAll(".diff-hunk");
    fireEvent.click(next);
    expect(hunks[0]).toHaveFocus();
    expect(hunks[0]).toHaveAttribute("data-selected", "true");
    fireEvent.click(next);
    expect(hunks[1]).toHaveFocus();
    fireEvent.click(next);
    expect(hunks[0]).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(3);
  });

  it("shows binary changes instead of an empty diff", async () => {
    mocks.getWorktreeDiff.mockResolvedValue(
      "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n",
    );
    render(<DiffViewer diffTarget="working:unstaged:logo.png" />);
    expect(await screen.findByText("sourceControl.diffViewer.binary")).toBeInTheDocument();
    expect(screen.queryByText("sourceControl.diffViewer.empty")).not.toBeInTheDocument();
  });

  it("uses unified view in narrow panes and restores the chosen wide layout", async () => {
    let resize: ResizeObserverCallback = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { container } = render(<DiffViewer diffTarget="working:unstaged:main.txt" />);
    await screen.findAllByRole("button", { name: "sourceControl.stageHunk" });
    const reportWidth = (width: number) =>
      act(() => resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
    reportWidth(500);
    expect(screen.getByRole("button", { name: "sourceControl.diffViewer.split" })).toBeDisabled();
    expect(container.querySelector(".diff-code--unified")).toBeInTheDocument();
    reportWidth(1000);
    expect(container.querySelector(".diff-code--split")).toBeInTheDocument();
  });

  it("retries failed requests and clears the error", async () => {
    mocks.getWorktreeDiff.mockRejectedValueOnce(new Error("offline"));
    render(<DiffViewer diffTarget="working:unstaged:main.txt" />);
    fireEvent.click(await screen.findByRole("button", { name: "sourceControl.diffViewer.retry" }));
    await screen.findAllByRole("button", { name: "sourceControl.stageHunk" });
    expect(screen.queryByText("sourceControl.diffViewer.loadFailed")).not.toBeInTheDocument();
  });

  it("ignores a previous target's response arriving after the new target", async () => {
    let resolveOld: (value: string) => void = () => {};
    mocks.getWorktreeDiff.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveOld = resolve;
      }),
    );
    const { rerender } = render(<DiffViewer diffTarget="working:unstaged:old.txt" />);
    await waitFor(() => expect(mocks.getWorktreeDiff).toHaveBeenCalledTimes(1));
    rerender(<DiffViewer diffTarget="working:unstaged:main.txt" />);
    await screen.findAllByRole("button", { name: "sourceControl.stageHunk" });
    resolveOld("diff --git a/stale.txt b/stale.txt\nBinary files differ");
    await waitFor(() => expect(screen.queryByText("stale.txt")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("main.txt");
  });

  it("prevents duplicate hunk writes while a request is pending", async () => {
    let complete: () => void = () => {};
    mocks.applyHunk.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    render(<DiffViewer diffTarget="working:unstaged:main.txt" />);
    const buttons = await screen.findAllByRole("button", { name: "sourceControl.stageHunk" });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(mocks.applyHunk).toHaveBeenCalledTimes(1);
    complete();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });
});
