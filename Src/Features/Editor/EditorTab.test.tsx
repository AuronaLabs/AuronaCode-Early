import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  emit: vi.fn(),
  save: vi.fn(),
  close: vi.fn(async () => undefined),
  removeRecovery: vi.fn(async () => undefined),
  updateRecovery: vi.fn(),
  flushRecovery: vi.fn(async () => undefined),
  unregisterRecovery: vi.fn(),
  discardRecovery: vi.fn(async () => undefined),
  resolveSave: null as null | ((value: { revision: number; diskFingerprint: string }) => void),
  changeValues: [] as string[],
}));

vi.mock("../../Foundation/Desktop", () => ({
  DesktopError: class DesktopError extends Error {
    code = "desktop_error";
  },
}));
vi.mock("../../Core/FileSystemService", () => ({
  FileSystemService: {
    toMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  },
}));
vi.mock("../../Foundation/EventBus", () => ({
  EventBus: {
    emit: mocks.emit,
    on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
      mocks.handlers.set(event, handler);
      return () => mocks.handlers.delete(event);
    }),
  },
}));
vi.mock("../../Foundation/IPC/EditorCommands", () => ({
  EditorIPC: {
    open: vi.fn(async (path: string) => ({
      path,
      revision: 0,
      savedRevision: 0,
      text: "initial",
      lineEnding: "lf",
      language: "typescript",
      lineCount: 1,
      diskFingerprint: "disk-1",
    })),
    save: mocks.save,
    close: mocks.close,
    clearSyncError: vi.fn(),
    applyEdit: vi.fn(async () => ({ revision: 1, lineCount: 1, dirty: true })),
  },
}));
vi.mock("./Model/RecoveryStore", () => ({
  RecoveryStore: {
    load: vi.fn(async () => null),
    remove: mocks.removeRecovery,
  },
}));
vi.mock("./Model/RecoveryCoordinator", () => ({
  RecoveryCoordinator: {
    update: mocks.updateRecovery,
    flush: mocks.flushRecovery,
    unregister: mocks.unregisterRecovery,
    discard: mocks.discardRecovery,
  },
}));
vi.mock("./AuronaEngine", async () => {
  const React = await import("react");
  return {
    AuronaEngine: ({ onChange }: { onChange?: (value: string) => void }) =>
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "editor-change",
          onClick: () => onChange?.(mocks.changeValues.shift() ?? "edited"),
        },
        "change",
      ),
  };
});
vi.mock("../../UI/Feedback/Toast", () => ({ showToast: vi.fn() }));

import { EditorTab } from "./EditorTab";

describe("EditorTab save checkpoints", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.resolveSave = null;
    mocks.changeValues = ["edited", "edited again"];
    mocks.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          mocks.resolveSave = resolve;
        }),
    );
  });

  it("keeps the document dirty when typing continues during save", async () => {
    render(<EditorTab path={"C:\\demo.ts"} isActive />);
    const change = await screen.findByTestId("editor-change");
    fireEvent.click(change);

    let saveTask: unknown;
    await act(async () => {
      saveTask = mocks.handlers.get("app:save-file")?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    fireEvent.click(change);
    act(() => mocks.resolveSave?.({ revision: 1, diskFingerprint: "disk-2" }));
    await act(async () => saveTask);

    expect(mocks.emit).not.toHaveBeenCalledWith("editor:file-saved", { path: "C:\\demo.ts" });
    expect(mocks.flushRecovery).toHaveBeenCalledWith("C:\\demo.ts");
  });

  it("clears recovery only when the saved checkpoint is still current", async () => {
    render(<EditorTab path={"C:\\clean.ts"} isActive />);
    fireEvent.click(await screen.findByTestId("editor-change"));

    let saveTask: unknown;
    await act(async () => {
      saveTask = mocks.handlers.get("app:save-file")?.();
      await Promise.resolve();
    });
    act(() => mocks.resolveSave?.({ revision: 1, diskFingerprint: "disk-2" }));
    await act(async () => saveTask);

    expect(mocks.discardRecovery).toHaveBeenCalledWith("C:\\clean.ts");
    expect(mocks.emit).toHaveBeenCalledWith("editor:file-saved", { path: "C:\\clean.ts" });
  });
});
