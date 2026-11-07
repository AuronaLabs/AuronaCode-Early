import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  releaseOutput: vi.fn(),
  releaseExit: vi.fn(),
  listenOutput: vi.fn<(...args: unknown[]) => Promise<() => void>>(),
  listenExit: vi.fn<(...args: unknown[]) => Promise<() => void>>(),
  spawn: vi.fn<(...args: unknown[]) => Promise<void>>(),
  close: vi.fn(async () => undefined),
  begin: vi.fn(),
  end: vi.fn(),
  ready: vi.fn(),
  failed: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {};
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    writeln() {}
    refresh() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("../../Core/TerminalService", () => ({
  TerminalManager: {
    beginTerminalSession: mocks.begin,
    endTerminalSession: mocks.end,
    markTerminalReady: mocks.ready,
    markTerminalFailed: mocks.failed,
  },
}));
vi.mock("../../Core/Workspace", () => ({
  WorkspaceService: {
    whenInitialized: async () => undefined,
    getCurrent: () => ({ primaryRoot: "/work" }),
  },
}));
vi.mock("../../Foundation/IPC/PtyCommands", () => ({
  PtyIPC: {
    listenOutput: mocks.listenOutput,
    listenExit: mocks.listenExit,
    spawn: mocks.spawn,
    close: mocks.close,
    resize: vi.fn(async () => undefined),
  },
}));
vi.mock("../../Foundation/Storage/UserConfigStore", () => ({
  UserConfigStore: { get: async () => ({}) },
}));
vi.mock("../../Foundation/I18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

import { TerminalView } from "./TerminalView";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("terminal view async ownership", () => {
  beforeEach(() => {
    mocks.listenOutput.mockResolvedValue(mocks.releaseOutput);
    mocks.listenExit.mockResolvedValue(mocks.releaseExit);
    mocks.spawn.mockResolvedValue(undefined);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 0),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("releases output listeners acquired after the view has unmounted", async () => {
    const subscription = deferred<() => void>();
    mocks.listenOutput.mockReturnValueOnce(subscription.promise);
    const view = render(<TerminalView id="terminal" isActive />);
    view.unmount();
    await act(async () => {
      subscription.resolve(mocks.releaseOutput);
    });
    expect(mocks.releaseOutput).toHaveBeenCalledTimes(1);
    expect(mocks.listenExit).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("releases exit listeners acquired after the view has unmounted", async () => {
    const subscription = deferred<() => void>();
    mocks.listenExit.mockReturnValueOnce(subscription.promise);
    const view = render(<TerminalView id="terminal" isActive />);
    await waitFor(() => expect(mocks.listenExit).toHaveBeenCalled());
    view.unmount();
    await act(async () => {
      subscription.resolve(mocks.releaseExit);
    });
    expect(mocks.releaseOutput).toHaveBeenCalledTimes(1);
    expect(mocks.releaseExit).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("ignores startup errors from an unmounted view when a new view is ready", async () => {
    const startup = deferred<void>();
    mocks.spawn.mockReturnValueOnce(startup.promise);
    const old = render(<TerminalView id="terminal" isActive />);
    await waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    old.unmount();
    render(<TerminalView id="terminal" isActive />);
    await waitFor(() => expect(mocks.ready).toHaveBeenCalledTimes(1));
    await act(async () => {
      startup.reject(new Error("old startup failed"));
    });
    expect(mocks.failed).not.toHaveBeenCalled();
    expect(mocks.ready).toHaveBeenCalledTimes(1);
  });

  it("closes a PTY that starts after the view is gone using its own session id", async () => {
    const startup = deferred<void>();
    mocks.spawn.mockReturnValueOnce(startup.promise);
    const view = render(<TerminalView id="terminal" isActive />);
    await waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    const session = mocks.spawn.mock.calls[0][3];
    view.unmount();
    await act(async () => {
      startup.resolve();
    });
    expect(mocks.close).toHaveBeenCalledWith("terminal", session);
    expect(mocks.ready).not.toHaveBeenCalled();
  });

  it("releases late listeners across twenty immediate mount/unmount cycles", async () => {
    for (let index = 0; index < 20; index++) {
      const view = render(<TerminalView id="terminal" isActive />);
      view.unmount();
      await act(async () => undefined);
    }
    expect(mocks.releaseOutput).toHaveBeenCalledTimes(20);
    expect(mocks.begin).toHaveBeenCalledTimes(20);
    expect(mocks.end).toHaveBeenCalledTimes(20);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
