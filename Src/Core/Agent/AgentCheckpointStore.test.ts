const mocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  document: undefined as { content: string; openState: "open" | "closed" } | undefined,
  getViewState: vi.fn(),
  getStatus: vi.fn(),
  restoreViewState: vi.fn(),
}));

vi.mock("../DocumentService", () => ({
  DocumentService: {
    get: () => mocks.document,
    applyEdits: vi.fn(),
  },
}));

vi.mock("../../Foundation/IPC/FileSystemCommands", () => ({
  FileSystemCommands: {
    readTextFile: mocks.readTextFile,
    writeTextFile: mocks.writeTextFile,
  },
}));

vi.mock("../Editor/EditorAdapter", () => ({
  EditorAdapter: {
    getStatus: mocks.getStatus,
    getViewState: mocks.getViewState,
    restoreViewState: mocks.restoreViewState,
  },
}));

import { AgentCheckpointStore, fingerprintAgentContent } from "./AgentCheckpointStore";

describe("AgentCheckpointStore", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.document = undefined;
    mocks.readTextFile.mockReset();
    mocks.writeTextFile.mockReset();
    mocks.getStatus.mockReturnValue({ path: "C:\\work\\main.ts", line: 3, column: 2 });
    mocks.getViewState.mockReturnValue({
      path: "C:\\work\\main.ts",
      line: 3,
      column: 2,
      scrollTop: 120,
      scrollLeft: 4,
    });
  });

  it("captures the editor view and refuses restore after a fingerprint change", async () => {
    mocks.readTextFile.mockResolvedValue("const value = 1;");
    const store = new AgentCheckpointStore();
    const checkpoint = await store.capture("task-1", ["C:\\work\\main.ts"], "Before edit");
    expect(checkpoint.files[0].fingerprint).toBe(fingerprintAgentContent("const value = 1;"));
    expect(checkpoint.editorViews["C:\\work\\main.ts"]).toMatchObject({ scrollTop: 120 });

    mocks.readTextFile.mockResolvedValue("changed externally");
    await expect(store.restore(checkpoint.id)).rejects.toThrow("target changed");
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });
});
