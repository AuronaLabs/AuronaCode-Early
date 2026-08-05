import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../Core/FileSystemService", () => ({
  FileSystemService: {
    basename: (path: string) => path.replaceAll("\\", "/").split("/").at(-1) ?? path,
  },
}));

vi.mock("../Foundation/Platform", () => ({
  PlatformService: { current: () => "windows" },
}));

vi.mock("../Foundation/Desktop/Dialog", () => ({
  desktopDialog: { openFile: vi.fn(async () => null) },
}));

vi.mock("../Foundation/Storage/WorkspaceStore", () => ({
  WorkspaceStore: {
    set: vi.fn(async () => undefined),
    init: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
  },
}));

import { filePathIdentity, useWorkbenchStore } from "./useWorkspaceStore";

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
});
