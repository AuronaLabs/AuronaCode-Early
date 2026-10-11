import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  write: vi.fn<(id: string, data: string) => Promise<void>>(async () => undefined),
  close: vi.fn(async () => undefined),
  outputListener: null as
    | null
    | ((payload: { id: string; session_id: string; seq: number; data: string }) => void),
  exitListener: null as
    | null
    | ((payload: { id: string; session_id: string; reason: string }) => void),
  getAvailableShells: vi.fn(async () => [
    { id: "pwsh", name: "PowerShell", path: "pwsh.exe", icon: "terminal" },
  ]),
}));

vi.mock("../Foundation/EventBus", () => ({ EventBus: { emit: mocks.emit } }));
vi.mock("../Foundation/IPC/PtyCommands", () => ({
  PtyIPC: {
    write: mocks.write,
    close: mocks.close,
    listenOutput: vi.fn(async (listener: typeof mocks.outputListener) => {
      mocks.outputListener = listener;
      return () => {
        mocks.outputListener = null;
      };
    }),
    listenExit: vi.fn(async (listener: typeof mocks.exitListener) => {
      mocks.exitListener = listener;
      return () => {
        mocks.exitListener = null;
      };
    }),
    getAvailableShells: mocks.getAvailableShells,
  },
}));

import { TerminalManager } from "./TerminalService";

describe("TerminalService", () => {
  afterEach(() => {
    TerminalManager.dispose();
    mocks.outputListener = null;
    mocks.exitListener = null;
  });

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

  it("creates one default terminal for concurrent panel opens", async () => {
    const [first, second] = await Promise.all([
      TerminalManager.ensureDefaultTerminal(),
      TerminalManager.ensureDefaultTerminal(),
    ]);

    expect(first.id).toBe(second.id);
    expect(TerminalManager.getTerminals()).toHaveLength(1);
  });

  it("returns the command output and exit code after the shell marker", async () => {
    const pending = TerminalManager.executeCommandAndWait(null, "pnpm test");
    await vi.waitFor(() => expect(TerminalManager.getTerminals()).toHaveLength(1));
    const terminal = TerminalManager.getTerminals()[0];
    TerminalManager.markTerminalReady(terminal.id);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());

    const command = mocks.write.mock.calls.at(-1)?.[1] ?? "";
    const marker = command.match(/__AURONA_CMD_[^:]+__/)?.[0];
    expect(marker).toBeTruthy();
    mocks.outputListener?.({
      id: terminal.id,
      session_id: "session-1",
      seq: 1,
      data: btoa(`suite output\r\n${marker}:7\r\n`),
    });

    await expect(pending).resolves.toEqual({ exitCode: 7, output: "suite output" });
  });
});
