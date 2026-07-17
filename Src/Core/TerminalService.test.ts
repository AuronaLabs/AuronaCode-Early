import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  write: vi.fn<(id: string, data: string) => Promise<void>>(async () => undefined),
  close: vi.fn(async () => undefined),
  getAvailableShells: vi.fn(async () => [
    { id: "pwsh", name: "PowerShell", path: "pwsh.exe", icon: "terminal" },
  ]),
}));

vi.mock("../Foundation/EventBus", () => ({ EventBus: { emit: mocks.emit } }));
vi.mock("../Foundation/IPC/PtyCommands", () => ({
  PtyIPC: {
    write: mocks.write,
    close: mocks.close,
    getAvailableShells: mocks.getAvailableShells,
  },
}));

import { TerminalManager } from "./TerminalService";

describe("TerminalService", () => {
  afterEach(() => TerminalManager.dispose());

  it("coalesces concurrent implicit terminal creation", async () => {
    const first = TerminalManager.executeCommand(null, "echo first");
    const second = TerminalManager.executeCommand(null, "echo second");

    await vi.waitFor(() => expect(TerminalManager.getTerminals()).toHaveLength(1));
    const terminal = TerminalManager.getTerminals()[0];
    TerminalManager.markTerminalReady(terminal.id);
    await Promise.all([first, second]);

    expect(TerminalManager.getTerminals()).toHaveLength(1);
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.write.mock.calls.every(([id]) => id === terminal.id)).toBe(true);
  });
});
