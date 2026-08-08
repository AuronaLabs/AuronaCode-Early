import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "../../Extension/CommandRegistry";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({}),
}));

vi.mock("../../Foundation/IPC/FileSystemCommands", () => ({
  FileSystemCommands: {
    setWorkspaceRoot: vi.fn(async () => undefined),
  },
}));

vi.mock("../../Foundation/Storage/WorkspaceStore", () => ({
  WorkspaceStore: {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => undefined),
  },
}));

const mocks = vi.hoisted(() => ({
  workspace: {
    listFiles: vi.fn(),
    searchText: vi.fn(),
    cancel: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../../Foundation/IPC/WorkspaceSearchCommands", () => ({
  WorkspaceSearchIPC: mocks.workspace,
}));

import { WorkspaceService } from "../../Core/WorkspaceService";
import { FliunoWorkspacePage } from "./FliunoWorkspacePage";

describe("FliunoWorkspacePage keyboard navigation", () => {
  const disposers: Array<() => void> = [];
  const settleDebounce = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 160));
    });
  };
  const mockedWorkspace = {
    id: "workspace:c:/repo",
    mode: "workspace" as const,
    roots: ["C:/repo"],
    primaryRoot: "C:/repo",
    trusted: false,
  };

  beforeEach(() => {
    vi.spyOn(WorkspaceService, "openRoot").mockImplementation(async () => undefined);
    vi.spyOn(WorkspaceService, "getCurrent").mockReturnValue(mockedWorkspace);
    vi.spyOn(WorkspaceService, "subscribe").mockImplementation((listener) => {
      listener(mockedWorkspace);
      return () => undefined;
    });
    mocks.workspace.listFiles.mockResolvedValue([
      { path: "C:/repo/alpha.ts", relativePath: "alpha.ts", name: "alpha.ts" },
      { path: "C:/repo/beta.ts", relativePath: "beta.ts", name: "beta.ts" },
    ]);
    mocks.workspace.searchText.mockResolvedValue({ results: [] });
    disposers.push(
      CommandRegistry.register({
        id: "test.alphaCommand",
        title: "Alpha Command",
        category: "测试",
        handler: vi.fn(),
      }),
      CommandRegistry.register({
        id: "test.betaCommand",
        title: "Beta Command",
        category: "测试",
        handler: vi.fn(),
      }),
      CommandRegistry.register({
        id: "test.gammaCommand",
        title: "Gamma Command",
        category: "测试",
        handler: vi.fn(),
      }),
    );
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.restoreAllMocks();
    mocks.workspace.listFiles.mockReset();
    mocks.workspace.searchText.mockReset();
    mocks.workspace.cancel.mockReset();
  });

  it("keeps rendering order, keyboard order and Enter execution consistent", async () => {
    render(<FliunoWorkspacePage />);

    const input = screen.getByPlaceholderText("搜索文件、内容、符号、命令或设置…");
    fireEvent.change(input, { target: { value: "a" } });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-fliuno-workspace-index]").length).toBeGreaterThan(1);
    });

    // 从 DOM 读取真实渲染顺序（卡片/行上的 data-fliuno-workspace-index 与 id）。
    const orderedIds = Array.from(
      document.querySelectorAll<HTMLElement>("[data-fliuno-workspace-index]"),
    )
      .sort(
        (left, right) =>
          Number(left.dataset.fliunoWorkspaceIndex) - Number(right.dataset.fliunoWorkspaceIndex),
      )
      .map((element) => element.getAttribute("data-result-id") ?? element.textContent ?? "");

    expect(orderedIds.length).toBeGreaterThan(1);

    // 默认没有任何选中项；第一次按下方向键才进入键盘选中逻辑。
    const first = document.querySelector<HTMLElement>('[data-fliuno-workspace-index="0"]');
    expect(first?.classList.contains("bg-[var(--material-interactive-active)]")).toBe(false);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => {
      const selected = document.querySelector<HTMLElement>('[data-fliuno-workspace-index="0"]');
      expect(selected?.classList.contains("bg-[var(--material-interactive-active)]")).toBe(true);
    });

    // Enter 必须执行当前可视选中项（display index 0 的元素）。
    const selectedElement = document.querySelector<HTMLElement>(
      '[data-fliuno-workspace-index="0"]',
    );
    const selectedTitle = selectedElement?.textContent ?? "";
    fireEvent.keyDown(input, { key: "Enter" });

    const alphaHandler = CommandRegistry.getCommands().find(
      (command) => command.id === "test.alphaCommand",
    )?.handler as unknown as ReturnType<typeof vi.fn> | undefined;
    const betaHandler = CommandRegistry.getCommands().find(
      (command) => command.id === "test.betaCommand",
    )?.handler as unknown as ReturnType<typeof vi.fn> | undefined;
    const gammaHandler = CommandRegistry.getCommands().find(
      (command) => command.id === "test.gammaCommand",
    )?.handler as unknown as ReturnType<typeof vi.fn> | undefined;
    const executed = [alphaHandler, betaHandler, gammaHandler].find((handler) =>
      handler?.mock.calls.length ? handler : undefined,
    );
    expect(executed).toBeDefined();
    expect(selectedTitle).toContain(
      executed === alphaHandler ? "Alpha" : executed === betaHandler ? "Beta" : "Gamma",
    );
    await settleDebounce();
  });

  it("removes a conflicting explicit prefix when a scope button is clicked", async () => {
    render(<FliunoWorkspacePage />);
    const input = screen.getByPlaceholderText("搜索文件、内容、符号、命令或设置…");
    fireEvent.change(input, { target: { value: ">save" } });

    fireEvent.click(screen.getByRole("button", { name: "文件" }));

    expect((input as HTMLInputElement).value).toBe("save");
    expect(
      screen
        .getByRole("button", { name: "文件" })
        .classList.contains("bg-[var(--material-interactive-active)]"),
    ).toBe(true);
    await settleDebounce();
  });
});
