import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { PtyIPC } from "../Foundation/IPC/PtyCommands";
import { TerminalManager } from "./TerminalService";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function readyTerminal() {
  const terminal = await TerminalManager.createTerminal();
  TerminalManager.markTerminalReady(terminal.id);
  return terminal;
}

function sendOutput(id: string, text: string) {
  mocks.outputListener?.({ id, session_id: "session-1", seq: 1, data: btoa(text) });
}

function commandMarker() {
  return mocks.write.mock.calls.at(-1)?.[1].match(/__AURONA_CMD_[^:]+__/)?.[0];
}

describe("TerminalService", () => {
  beforeEach(() => {
    mocks.getAvailableShells.mockResolvedValue([
      { id: "pwsh", name: "PowerShell", path: "pwsh.exe", icon: "terminal" },
    ]);
  });
  afterEach(() => {
    TerminalManager.dispose();
    mocks.outputListener = null;
    mocks.exitListener = null;
    vi.useRealTimers();
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

  it("rejects late terminal creation after disposal without reviving old shells", async () => {
    const discovery = deferred<Awaited<ReturnType<typeof PtyIPC.getAvailableShells>>>();
    mocks.getAvailableShells.mockReturnValueOnce(discovery.promise);
    const old = TerminalManager.ensureDefaultTerminal();
    const rejected = expect(old).rejects.toThrow("disposed");
    TerminalManager.dispose();
    const fresh = await TerminalManager.ensureDefaultTerminal();
    discovery.resolve([{ id: "old", name: "Old", path: "old", icon: "terminal" }]);
    await rejected;
    expect(TerminalManager.getTerminals()).toEqual([fresh]);
    expect((await TerminalManager.getAvailableShells())[0].id).toBe("pwsh");
  });

  it("retries shell discovery after a transient error", async () => {
    mocks.getAvailableShells.mockRejectedValueOnce(new Error("offline"));
    expect(await TerminalManager.getAvailableShells()).toEqual([]);
    expect((await TerminalManager.getAvailableShells())[0].id).toBe("pwsh");
    expect(mocks.getAvailableShells).toHaveBeenCalledTimes(2);
  });

  it("coalesces parallel shell discovery", async () => {
    await Promise.all([TerminalManager.getAvailableShells(), TerminalManager.getAvailableShells()]);
    expect(mocks.getAvailableShells).toHaveBeenCalledTimes(1);
  });

  it("does not activate an unknown terminal", () => {
    TerminalManager.setActiveTerminal("missing");
    expect(TerminalManager.getActiveTerminalId()).toBeNull();
  });

  it("clears the startup timeout after readiness", async () => {
    vi.useFakeTimers();
    const terminal = await TerminalManager.createTerminal();
    const command = TerminalManager.executeCommand(terminal.id, "echo ready");
    expect(vi.getTimerCount()).toBe(1);
    TerminalManager.markTerminalReady(terminal.id);
    await command;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not dispatch a ready command after synchronous service cleanup", async () => {
    const terminal = await readyTerminal();
    const pending = TerminalManager.executeCommand(terminal.id, "echo never");
    const rejected = expect(pending).rejects.toThrow("closed");
    TerminalManager.dispose();
    await rejected;
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps the initial command waiting through the first PTY session registration", async () => {
    const terminal = await TerminalManager.createTerminal();
    const pending = TerminalManager.executeCommand(terminal.id, "echo ready");
    TerminalManager.beginTerminalSession(terminal.id, "first");
    TerminalManager.markTerminalReady(terminal.id, "first");
    await pending;
    expect(mocks.write).toHaveBeenCalledWith(terminal.id, "echo ready\r\n");
  });

  it("rejects a replaced session and ignores its late readiness", async () => {
    const terminal = await TerminalManager.createTerminal();
    TerminalManager.beginTerminalSession(terminal.id, "old");
    const old = TerminalManager.executeCommand(terminal.id, "echo old");
    const rejected = expect(old).rejects.toThrow("replaced");
    TerminalManager.beginTerminalSession(terminal.id, "new");
    await rejected;
    const next = TerminalManager.executeCommand(terminal.id, "echo new");
    TerminalManager.markTerminalReady(terminal.id, "old");
    await Promise.resolve();
    expect(mocks.write).not.toHaveBeenCalled();
    TerminalManager.markTerminalReady(terminal.id, "new");
    await next;
    expect(mocks.write).toHaveBeenCalledWith(terminal.id, "echo new\r\n");
  });

  it("filters old PTY output and exit events for a reused terminal id", async () => {
    const terminal = await TerminalManager.createTerminal();
    TerminalManager.beginTerminalSession(terminal.id, "current");
    TerminalManager.markTerminalReady(terminal.id, "current");
    const pending = TerminalManager.executeCommandAndWait(terminal.id, "echo result");
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
    mocks.exitListener?.({ id: terminal.id, session_id: "old", reason: "old session closed" });
    sendOutput(terminal.id, `old output\r\n${commandMarker()}:9\r\n`);
    mocks.outputListener?.({
      id: terminal.id,
      session_id: "current",
      seq: 1,
      data: btoa(`new output\r\n${commandMarker()}:0\r\n`),
    });
    await expect(pending).resolves.toEqual({ exitCode: 0, output: "new output" });
  });

  it("releases a running command when its PTY session ends", async () => {
    const terminal = await TerminalManager.createTerminal();
    TerminalManager.beginTerminalSession(terminal.id, "current");
    TerminalManager.markTerminalReady(terminal.id, "current");
    const pending = TerminalManager.executeCommandAndWait(terminal.id, "echo result");
    const rejected = expect(pending).rejects.toThrow("closed");
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
    TerminalManager.endTerminalSession(terminal.id, "old");
    expect(mocks.outputListener).not.toBeNull();
    TerminalManager.endTerminalSession(terminal.id, "current");
    await rejected;
    expect(mocks.outputListener).toBeNull();
    expect(mocks.exitListener).toBeNull();
  });

  it("cancels while waiting for startup without writing a command", async () => {
    const terminal = await TerminalManager.createTerminal();
    const controller = new AbortController();
    const pending = TerminalManager.executeCommandAndWait(
      terminal.id,
      "echo never",
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow("cancelled");
    controller.abort();
    await rejected;
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not create a terminal for an already cancelled command", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      TerminalManager.executeCommandAndWait(null, "echo never", controller.signal),
    ).rejects.toThrow("cancelled");
    expect(TerminalManager.getTerminals()).toEqual([]);
  });

  it.each(["close", "dispose"])("releases running command subscriptions on %s", async (action) => {
    const terminal = await readyTerminal();
    const pending = TerminalManager.executeCommandAndWait(terminal.id, "echo waiting");
    const rejected = expect(pending).rejects.toThrow(/closed|disposed/);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
    if (action === "close") TerminalManager.removeTerminal(terminal.id);
    else TerminalManager.dispose();
    await rejected;
    expect(mocks.outputListener).toBeNull();
    expect(mocks.exitListener).toBeNull();
  });

  it("releases listeners that register after cancellation", async () => {
    const terminal = await readyTerminal();
    const subscription = deferred<() => void>();
    const release = vi.fn();
    vi.mocked(PtyIPC.listenOutput).mockReturnValueOnce(subscription.promise);
    const controller = new AbortController();
    const pending = TerminalManager.executeCommandAndWait(
      terminal.id,
      "echo never",
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(PtyIPC.listenOutput).toHaveBeenCalled());
    controller.abort();
    await rejected;
    subscription.resolve(release);
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(PtyIPC.listenExit).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("preserves UTF-8 across chunks and waits for the complete signed exit code", async () => {
    const terminal = await readyTerminal();
    const pending = TerminalManager.executeCommandAndWait(terminal.id, "echo result");
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
    const marker = commandMarker();
    sendOutput(terminal.id, "\xe4");
    sendOutput(terminal.id, `\xb8\xad\r\n${marker}:-1`);
    await Promise.resolve();
    expect(settled).toBe(false);
    sendOutput(terminal.id, "23\r\n");
    await expect(pending).resolves.toEqual({ exitCode: -123, output: "中" });
  });

  it("ignores echoed marker text inside the command line", async () => {
    const terminal = await readyTerminal();
    const pending = TerminalManager.executeCommandAndWait(terminal.id, "echo result");
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
    const marker = commandMarker();
    sendOutput(terminal.id, `PS> echo ${marker}:0\r\nactual output\r\n`);
    await Promise.resolve();
    expect(settled).toBe(false);
    sendOutput(terminal.id, `${marker}:0\r\n`);
    await expect(pending).resolves.toMatchObject({ exitCode: 0 });
  });

  it.each(["bash", "fish", "cmd"])("uses the command protocol for %s", async (id) => {
    mocks.getAvailableShells.mockResolvedValueOnce([{ id, name: id, path: id, icon: "terminal" }]);
    const terminal = await readyTerminal();
    const pending = TerminalManager.executeCommandAndWait(terminal.id, "echo result");
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
    const command = mocks.write.mock.calls.at(-1)?.[1] ?? "";
    if (id === "bash") {
      expect(command).not.toContain("\n;");
      expect(command).toContain("__aurona_exit=$?");
    } else if (id === "fish") expect(command).toContain("$status");
    else expect(command).toContain("%errorlevel%");
    sendOutput(terminal.id, `${commandMarker()}:0\r\n`);
    await expect(pending).resolves.toMatchObject({ exitCode: 0 });
  });
});
