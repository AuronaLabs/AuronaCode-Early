import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsService } from "../Core/DiagnosticsService";
import { pathToFileUri } from "../Shared/Utils/UriUtils";

vi.mock("../Core/FileSystemService", () => ({
  FileSystemService: {
    basename: (path: string) => path.replaceAll("\\", "/").split("/").at(-1) ?? path,
  },
}));

vi.mock("../Foundation/Platform", () => ({
  PlatformService: { current: () => "windows" },
}));

vi.mock("../Foundation/IPC/EditorCommands", () => ({
  EditorIPC: {
    openDialog: vi.fn(async () => null),
  },
}));

vi.mock("../Foundation/Storage/WorkspaceStore", () => ({
  WorkspaceStore: {
    set: vi.fn(async () => undefined),
    init: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
  },
}));

import {
  canonicalizeExtensionContainerId,
  filePathIdentity,
  migrateWorkbenchExtensionTabs,
  useWorkbenchStore,
} from "./useWorkspaceStore";

describe("workbench file identity", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({ tabs: [], activeTabId: null });
  });

  it("normalizes Windows separators and case", () => {
    expect(filePathIdentity("E:\\Project\\Src\\Main.ts")).toBe(
      filePathIdentity("e:/project/src/main.ts"),
    );
  });

  it("activates the existing editor instead of opening the same file twice", () => {
    const store = useWorkbenchStore.getState();
    store.openFile("E:\\Project\\Src\\Main.ts");
    store.openFile("e:/project/src/main.ts");

    const state = useWorkbenchStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe("E:\\Project\\Src\\Main.ts");
  });

  it("routes file tabs through the same deduplication path", () => {
    const store = useWorkbenchStore.getState();
    store.openFile("E:\\Project\\Src\\Main.ts");
    store.openTab({
      id: "e:/project/src/main.ts",
      type: "file",
      title: "Main.ts",
      path: "e:/project/src/main.ts",
    });

    expect(useWorkbenchStore.getState().tabs).toHaveLength(1);
  });

  it("clears diagnostics when the owning tab closes", () => {
    const uri = pathToFileUri("E:\\Project\\Src\\Main.ts");
    DiagnosticsService.update({
      uri,
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "boom",
        },
      ],
    });

    const store = useWorkbenchStore.getState();
    store.openFile("E:\\Project\\Src\\Main.ts");
    const tab = useWorkbenchStore.getState().tabs[0];
    expect(tab).toBeDefined();
    if (!tab) return;
    store.closeTab(tab);

    expect(DiagnosticsService.get(uri)).toBeUndefined();
  });

  it("migrates legacy extension tabs and keeps a canonical duplicate", () => {
    const tabs = migrateWorkbenchExtensionTabs([
      {
        id: "extension:aurona.markdown",
        type: "extension",
        title: "Legacy Markdown",
        path: "aurona.markdown",
      },
      {
        id: "extension:auronalabs.markdown",
        type: "extension",
        title: "Markdown Preview",
        path: "auronalabs.markdown",
      },
    ]);

    expect(tabs).toEqual([
      {
        id: "extension:auronalabs.markdown",
        type: "extension",
        title: "Markdown Preview",
        path: "auronalabs.markdown",
      },
    ]);
    expect(canonicalizeExtensionContainerId("extension:aurona.planner")).toBe(
      "extension:auronalabs.planner",
    );
  });

  it("canonicalizes legacy extension tabs opened after startup", () => {
    useWorkbenchStore.getState().openTab({
      id: "extension:aurona.markdown",
      type: "extension",
      title: "Markdown Preview",
      path: "aurona.markdown",
    });

    expect(useWorkbenchStore.getState()).toMatchObject({
      activeTabId: "extension:auronalabs.markdown",
      tabs: [
        {
          id: "extension:auronalabs.markdown",
          path: "auronalabs.markdown",
        },
      ],
    });
  });
});
