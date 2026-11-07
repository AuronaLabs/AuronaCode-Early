import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAvailableShells: vi.fn(async () => [
    { id: "pwsh", name: "PowerShell", path: "pwsh.exe", icon: "terminal" },
  ]),
  logError: vi.fn(),
  workbench: {
    isBottomPanelOpen: false,
    toggleBottomPanel: vi.fn(),
    setActiveBottomPanel: vi.fn(),
  },
}));
vi.mock("../Foundation/IPC/PtyCommands", () => ({
  PtyIPC: { getAvailableShells: mocks.getAvailableShells, close: vi.fn(async () => undefined) },
}));
vi.mock("../Foundation/Logger", () => ({ Logger: { error: mocks.logError } }));
vi.mock("./Workbench/useWorkbenchStore", () => ({
  useWorkbenchStore: { getState: () => mocks.workbench },
}));

import { TerminalManager } from "../Core/TerminalService";
import { EventBus } from "../Foundation/EventBus";
import { initializeTerminalStore, useTerminalStore } from "./useTerminalStore";

describe("terminal store lifecycle", () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it("does not publish shell discovery or create terminals after cleanup", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof mocks.getAvailableShells>>) => void;
    mocks.getAvailableShells.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    dispose = initializeTerminalStore();
    EventBus.emit("app:toggle-terminal", true);
    dispose();
    resolve([{ id: "old", name: "Old", path: "old", icon: "terminal" }]);
    await new Promise((done) => setTimeout(done, 0));
    expect(useTerminalStore.getState().availableShells).toEqual([]);
    expect(TerminalManager.getTerminals()).toEqual([]);
  });

  it("coalesces panel and command initialization into one terminal", async () => {
    dispose = initializeTerminalStore();
    EventBus.emit("app:toggle-terminal", true);
    await TerminalManager.ensureDefaultTerminal();
    await vi.waitFor(() => expect(useTerminalStore.getState().terminals).toHaveLength(1));
    expect(TerminalManager.getTerminals()).toHaveLength(1);
  });

  it("recreates the default terminal after the last terminal has been closed", async () => {
    dispose = initializeTerminalStore();
    EventBus.emit("app:toggle-terminal", true);
    await vi.waitFor(() => expect(useTerminalStore.getState().terminals).toHaveLength(1));
    const first = useTerminalStore.getState().terminals[0];
    TerminalManager.removeTerminal(first.id);
    EventBus.emit("app:toggle-terminal", true);
    await vi.waitFor(() => expect(useTerminalStore.getState().terminals).toHaveLength(1));
    expect(useTerminalStore.getState().activeTerminalId).not.toBe(first.id);
  });

  it("clears editing state and removes subscriptions across repeated lifecycles", () => {
    for (let index = 0; index < 20; index++) {
      const stop = initializeTerminalStore();
      useTerminalStore.setState({ editingTerminalId: "old", editingName: "old name" });
      stop();
    }
    EventBus.emit("app:toggle-terminal", true);
    expect(mocks.workbench.toggleBottomPanel).not.toHaveBeenCalled();
    expect(useTerminalStore.getState()).toMatchObject({ editingTerminalId: null, editingName: "" });
  });
});
