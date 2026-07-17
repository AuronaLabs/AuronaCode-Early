import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const disposeWorkbench = vi.fn();
  const disposeTerminal = vi.fn();
  const disposeEditor = vi.fn();
  const disposeCommands = vi.fn();
  return {
    disposeWorkbench,
    disposeTerminal,
    disposeEditor,
    disposeCommands,
    initializeWorkbenchStore: vi.fn<() => Promise<() => void>>(async () => disposeWorkbench),
    initializeTerminalStore: vi.fn(() => disposeTerminal),
    initializeEditorStore: vi.fn(() => disposeEditor),
    registerWorkbenchCommands: vi.fn(() => disposeCommands),
    flush: vi.fn(async () => undefined),
    flushRecovery: vi.fn(async () => undefined),
    destroyWindow: vi.fn(async () => undefined),
    unlistenClose: vi.fn(),
    closeHandler: null as ((event: { preventDefault(): void }) => Promise<void>) | null,
  };
});

vi.mock("../Foundation/Storage/WorkspaceStore", () => ({
  WorkspaceStore: { flush: mocks.flush },
}));
vi.mock("../State/useWorkspaceStore", () => ({
  initializeWorkbenchStore: mocks.initializeWorkbenchStore,
}));
vi.mock("../State/useTerminalStore", () => ({
  initializeTerminalStore: mocks.initializeTerminalStore,
}));
vi.mock("../State/useEditorStore", () => ({
  initializeEditorStore: mocks.initializeEditorStore,
}));
vi.mock("./Commands", () => ({ registerWorkbenchCommands: mocks.registerWorkbenchCommands }));
vi.mock("../Features/Editor/Model/RecoveryCoordinator", () => ({
  RecoveryCoordinator: { flushAll: mocks.flushRecovery },
}));
vi.mock("../Foundation/Desktop", () => ({
  desktopWindow: {
    onCloseRequested: vi.fn(async (handler) => {
      mocks.closeHandler = handler;
      return mocks.unlistenClose;
    }),
    destroy: mocks.destroyWindow,
  },
}));

import { AppServices } from "./AppServices";

describe("AppServices", () => {
  afterEach(() => {
    AppServices.dispose();
    vi.clearAllMocks();
  });

  it("并发和重复启动不会注册重复资源", async () => {
    await Promise.all([AppServices.start(), AppServices.start()]);
    await AppServices.start();

    expect(mocks.initializeWorkbenchStore).toHaveBeenCalledTimes(1);
    expect(mocks.initializeTerminalStore).toHaveBeenCalledTimes(1);
    expect(mocks.initializeEditorStore).toHaveBeenCalledTimes(1);
    expect(mocks.registerWorkbenchCommands).toHaveBeenCalledTimes(1);
  });

  it("flushes editor recovery before destroying the desktop window", async () => {
    await AppServices.start();
    const preventDefault = vi.fn();
    await mocks.closeHandler?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.flushRecovery).toHaveBeenCalledOnce();
    expect(mocks.destroyWindow).toHaveBeenCalledOnce();
    expect(mocks.flushRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.destroyWindow.mock.invocationCallOrder[0],
    );
  });

  it("释放所有资源后允许完整重新启动", async () => {
    await AppServices.start();
    AppServices.dispose();

    expect(mocks.disposeWorkbench).toHaveBeenCalledOnce();
    expect(mocks.disposeTerminal).toHaveBeenCalledOnce();
    expect(mocks.disposeEditor).toHaveBeenCalledOnce();
    expect(mocks.disposeCommands).toHaveBeenCalledOnce();
    expect(mocks.flush).toHaveBeenCalledOnce();

    await AppServices.start();
    expect(mocks.initializeWorkbenchStore).toHaveBeenCalledTimes(2);
  });

  it("在异步 hydration 结束前卸载时不会留下后台资源", async () => {
    let completeHydration: ((dispose: () => void) => void) | undefined;
    mocks.initializeWorkbenchStore.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          completeHydration = resolve;
        }),
    );

    const starting = AppServices.start();
    AppServices.dispose();
    completeHydration?.(mocks.disposeWorkbench);
    await starting;

    expect(mocks.disposeWorkbench).toHaveBeenCalledOnce();
    expect(mocks.initializeTerminalStore).not.toHaveBeenCalled();
    expect(mocks.initializeEditorStore).not.toHaveBeenCalled();
    expect(mocks.registerWorkbenchCommands).not.toHaveBeenCalled();
  });
});
