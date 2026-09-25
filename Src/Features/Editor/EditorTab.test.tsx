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
  BaseDirectory: { AppLocalData: 23 },
  desktopFileSystem: {
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => undefined),
    readTextFile: vi.fn(async () => ""),
    writeTextFile: vi.fn(async () => undefined),
    writeTextFileAtomic: vi.fn(async () => undefined),
  },
  invokeDesktop: vi.fn(async () => undefined),
  listenDesktop: vi.fn(async () => () => undefined),
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
    applyEdits: vi.fn(async () => ({ revision: 1, lineCount: 1, dirty: true })),
  },
}));
vi.mock("../../Core/Recovery/RecoveryStore", () => ({
  RecoveryStore: {
    load: vi.fn(async () => null),
    remove: mocks.removeRecovery,
  },
}));
vi.mock("../../Core/Recovery/RecoveryCoordinator", () => ({
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
    AuronaEngine: ({
      onChange,
      externalContent,
    }: {
      onChange?: (value: string) => void;
      externalContent?: { content: string; nonce: number } | null;
    }) =>
      React.createElement(
        "div",
        null,
        React.createElement(
          "button",
          {
            type: "button",
            "data-testid": "editor-change",
            onClick: () => onChange?.(mocks.changeValues.shift() ?? "edited"),
          },
          "change",
        ),
        React.createElement(
          "span",
          { "data-testid": "external-content" },
          externalContent?.content ?? "",
        ),
      ),
  };
});
vi.mock("../../UI/Feedback/Toast", () => ({ showToast: vi.fn() }));

import { DocumentService } from "../../Core/DocumentService";
import { EditorSaveRegistry } from "../../Core/EditorSaveRegistry";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import { EditorTab } from "./EditorTab";

describe("EditorTab save checkpoints", () => {
  beforeEach(() => {
    UserConfigStore.resetCache();
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

  it("forwards external workspace edits into the open editor", async () => {
    render(<EditorTab path={"C:\\external.ts"} isActive />);
    await screen.findByTestId("editor-change");

    await act(async () => {
      await DocumentService.applyEdits("C:\\external.ts", [], "updated external content");
    });

    await waitFor(() =>
      expect(screen.getByTestId("external-content")).toHaveTextContent("updated external content"),
    );
  });

  it("previews unsaved Markdown while keeping the source editor mounted", async () => {
    mocks.changeValues = ["# Draft heading"];
    render(<EditorTab path={"C:\\draft.md"} isActive />);
    const editor = await screen.findByTestId("editor-change");
    fireEvent.click(editor);

    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(await screen.findByRole("heading", { name: "Draft heading" })).toBeInTheDocument();
    expect(screen.getByTestId("editor-change")).toBe(editor);

    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    expect(screen.getByTestId("editor-change")).toBe(editor);
    expect(screen.queryByRole("heading", { name: "Draft heading" })).not.toBeInTheDocument();
  });

  it("hides the capsule and returns to source when disabled in settings", async () => {
    mocks.changeValues = ["# Capsule preview"];
    render(<EditorTab path={"C:\\capsule.md"} isActive />);
    fireEvent.click(await screen.findByTestId("editor-change"));
    const capsule = await screen.findByRole("toolbar", { name: "Aurona AI Capsule" });
    fireEvent.click(capsule.querySelectorAll("button")[1]);
    expect(await screen.findByRole("heading", { name: "Capsule preview" })).toBeInTheDocument();

    await act(async () => {
      await UserConfigStore.set({ editorCapsuleEnabled: false });
      mocks.handlers.get("settings:editor-changed")?.();
    });
    await waitFor(() =>
      expect(screen.queryByRole("toolbar", { name: "Aurona AI Capsule" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: "Capsule preview" })).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-change")).toBeInTheDocument();

    await act(async () => {
      await UserConfigStore.set({ editorCapsuleEnabled: true });
      mocks.handlers.get("settings:editor-changed")?.();
    });
    expect(await screen.findByRole("toolbar", { name: "Aurona AI Capsule" })).toBeInTheDocument();
  });

  it("saves an inactive tab by path and keeps it open when edits continue", async () => {
    render(<EditorTab path={"C:\\inactive.ts"} isActive={false} />);
    const change = await screen.findByTestId("editor-change");
    fireEvent.click(change);

    let saved: Promise<boolean> = Promise.resolve(false);
    act(() => {
      saved = EditorSaveRegistry.save("C:\\inactive.ts");
    });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    fireEvent.click(change);
    let result = true;
    await act(async () => {
      mocks.resolveSave?.({ revision: 1, diskFingerprint: "disk-2" });
      result = await saved;
    });
    expect(result).toBe(false);
    expect(mocks.emit).toHaveBeenCalledWith("editor:dirty-set", { path: "C:\\inactive.ts" });
  });
});
