import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandRegistry } from "../../Extension/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";

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
import { FliunoModal } from "./FliunoModal";

describe("FliunoModal keyboard navigation", () => {
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
    render(<FliunoModal />);

    act(() => {
      EventBus.emit("app:show-fliuno");
    });

    const input = screen.getByPlaceholderText("搜索命令、文件或设置…");
    fireEvent.change(input, { target: { value: "a" } });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-fliuno-index]").length).toBeGreaterThan(1);
    });

    // 渲染顺序 = data-fliuno-index 升序；默认无选中项。
    const indexes = Array.from(document.querySelectorAll<HTMLElement>("[data-fliuno-index]")).map(
      (element) => Number(element.dataset.fliunoIndex),
    );
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    expect(document.querySelector('[data-fliuno-index="0"]')?.getAttribute("aria-selected")).toBe(
      "false",
    );

    // 第一次 ↓ 选中第 0 项，Enter 执行它。
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => {
      expect(document.querySelector('[data-fliuno-index="0"]')?.getAttribute("aria-selected")).toBe(
        "true",
      );
    });
    const selectedElement = document.querySelector<HTMLElement>('[data-fliuno-index="0"]');
    const selectedTitle = selectedElement?.textContent ?? "";
    fireEvent.keyDown(input, { key: "Enter" });

    const handlers = ["test.alphaCommand", "test.betaCommand", "test.gammaCommand"].map(
      (id) => CommandRegistry.getCommands().find((command) => command.id === id)?.handler,
    ) as Array<ReturnType<typeof vi.fn>>;
    const executedIndex = handlers.findIndex((handler) => handler.mock.calls.length > 0);
    expect(executedIndex).toBeGreaterThanOrEqual(0);
    expect(selectedTitle).toContain(["Alpha", "Beta", "Gamma"][executedIndex]);

    // Esc 关闭悬浮窗。
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("fliuno-surface")).toBeNull();
    await settleDebounce();
  });

  it("Tab cycles scope and re-scopes results", async () => {
    render(<FliunoModal />);

    act(() => {
      EventBus.emit("app:show-fliuno");
    });

    const input = screen.getByPlaceholderText("搜索命令、文件或设置…");
    fireEvent.change(input, { target: { value: "alpha" } });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-fliuno-index]").length).toBeGreaterThan(1);
    });

    // all → commands → files：两下 Tab 后结果应只剩文件 alpha.ts。
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(input, { key: "Tab" });

    await waitFor(() => {
      const rows = document.querySelectorAll("[data-fliuno-index]");
      expect(rows.length).toBe(1);
      expect(rows[0]?.textContent).toContain("alpha.ts");
    });
    await settleDebounce();
  });
});
