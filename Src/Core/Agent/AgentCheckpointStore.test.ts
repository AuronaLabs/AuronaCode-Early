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

import {
  AGENT_CHECKPOINT_CORRUPT_STORAGE_PREFIX,
  AGENT_CHECKPOINT_STAGING_STORAGE_KEY,
  AGENT_CHECKPOINT_STORAGE_KEY,
  AgentCheckpointStore,
  fingerprintAgentContent,
} from "./AgentCheckpointStore";

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

  it("backs up corrupt checkpoint data before starting empty", () => {
    localStorage.setItem(AGENT_CHECKPOINT_STORAGE_KEY, "not-json");

    const store = new AgentCheckpointStore();

    expect(store.listForTask("task-1")).toEqual([]);
    const backups = Object.keys(localStorage).filter((key) =>
      key.startsWith(AGENT_CHECKPOINT_CORRUPT_STORAGE_PREFIX),
    );
    expect(backups).toHaveLength(1);
    expect(localStorage.getItem(backups[0])).toBe("not-json");
  });

  it("does not promote a malformed checkpoint entry", () => {
    localStorage.setItem(
      AGENT_CHECKPOINT_STORAGE_KEY,
      JSON.stringify([{ id: "broken", files: [{ path: "a.ts" }] }]),
    );

    const store = new AgentCheckpointStore();

    expect(store.listForTask("task-1")).toEqual([]);
    expect(
      Object.keys(localStorage).some((key) =>
        key.startsWith(AGENT_CHECKPOINT_CORRUPT_STORAGE_PREFIX),
      ),
    ).toBe(true);
  });

  it("keeps the old primary list when checkpoint promotion fails", async () => {
    mocks.readTextFile.mockResolvedValue("const value = 1;");
    const store = new AgentCheckpointStore();
    const checkpoint = await store.capture("task-1", ["C:\\work\\main.ts"], "Before edit");
    const previous = localStorage.getItem(AGENT_CHECKPOINT_STORAGE_KEY);
    expect(previous).not.toBeNull();

    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === AGENT_CHECKPOINT_STORAGE_KEY) throw new Error("quota");
      return originalSetItem.call(this, key, value);
    });
    try {
      store.deleteForTask(checkpoint.taskId);
      expect(localStorage.getItem(AGENT_CHECKPOINT_STORAGE_KEY)).toBe(previous);
      expect(localStorage.getItem(AGENT_CHECKPOINT_STAGING_STORAGE_KEY)).not.toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });

  it("rolls back files already written when a multi-file restore fails", async () => {
    const firstPath = "C:\\work\\first.ts";
    const secondPath = "C:\\work\\second.ts";
    mocks.readTextFile.mockImplementation(async (path: string) =>
      path === firstPath ? "first" : "second",
    );
    const store = new AgentCheckpointStore();
    const checkpoint = await store.capture("task-1", [firstPath, secondPath], "Before edit");
    checkpoint.files[0].content = "restored-first";
    checkpoint.files[1].content = "restored-second";
    mocks.writeTextFile.mockImplementationOnce(async () => undefined);
    mocks.writeTextFile.mockRejectedValueOnce(new Error("disk full"));
    mocks.writeTextFile.mockImplementation(async () => undefined);

    await expect(store.restore(checkpoint.id)).rejects.toThrow("disk full");
    expect(mocks.writeTextFile.mock.calls.map(([path, content]) => [path, content])).toEqual([
      [firstPath, "restored-first"],
      [secondPath, "restored-second"],
      [secondPath, "second"],
      [firstPath, "first"],
    ]);
  });
});
