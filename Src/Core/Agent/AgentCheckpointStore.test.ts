const mocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  document: undefined as { content: string; openState: "open" | "closed" } | undefined,
  getViewState: vi.fn(),
  getStatus: vi.fn(),
  restoreViewState: vi.fn(),
  stored: new Map<string, string>(),
  storageWrite: vi.fn(),
  generation: vi.fn(),
}));

vi.mock("../../Foundation/IPC/AgentStorageCommands", () => ({
  AgentStorageIPC: {
    read: vi.fn(async (slot: string) => mocks.stored.get(slot) ?? null),
    write: mocks.storageWrite,
  },
}));

vi.mock("../DocumentService", () => ({
  DocumentService: {
    get: () => mocks.document,
    applyEdits: vi.fn(),
  },
}));

vi.mock("../../Foundation/IPC/FileSystemCommands", () => ({
  FileSystemCommands: {
    generation: mocks.generation,
    writeCompare: async (path: string, content: string) => mocks.writeTextFile(path, content),
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
  AGENT_CHECKPOINT_STORAGE_KEY,
  AgentCheckpointStore,
  fingerprintAgentContent,
} from "./AgentCheckpointStore";

describe("AgentCheckpointStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("crypto", webcrypto);
    mocks.stored.clear();
    mocks.storageWrite.mockReset().mockImplementation(async (slot: string, text: string) => {
      mocks.stored.set(slot, text);
    });
    mocks.document = undefined;
    mocks.generation.mockReset().mockResolvedValue(1);
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
    expect(checkpoint.files[0].fingerprint).toBe(await fingerprintAgentContent("const value = 1;"));
    expect(checkpoint.editorViews["C:\\work\\main.ts"]).toMatchObject({ scrollTop: 120 });

    mocks.readTextFile.mockResolvedValue("changed externally");
    await expect(store.restore(checkpoint.id)).rejects.toThrow("target changed");
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("preserves corrupt legacy data and pauses checkpoint writes", async () => {
    localStorage.setItem(AGENT_CHECKPOINT_STORAGE_KEY, "not-json");

    const store = new AgentCheckpointStore();

    expect(store.listForTask("task-1")).toEqual([]);
    await expect(store.initialize()).rejects.toThrow("malformed");
    expect(localStorage.getItem(AGENT_CHECKPOINT_STORAGE_KEY)).toBe("not-json");
    expect(mocks.storageWrite).not.toHaveBeenCalled();
  });

  it("restores an Agent edit using the sealed after fingerprint", async () => {
    mocks.readTextFile.mockResolvedValue("before");
    const store = new AgentCheckpointStore();
    const checkpoint = await store.capture("task-1", ["C:\\work\\main.ts"], "Before edit");
    mocks.readTextFile.mockResolvedValue("after");
    await store.seal(checkpoint.id);
    await store.restore(checkpoint.id);
    expect(mocks.writeTextFile).toHaveBeenCalledWith("C:\\work\\main.ts", "before");
  });

  it("rejects later user edits after sealing the Agent result", async () => {
    mocks.readTextFile.mockResolvedValue("before");
    const store = new AgentCheckpointStore();
    const checkpoint = await store.capture("task-1", ["C:\\work\\main.ts"], "Before edit");
    mocks.readTextFile.mockResolvedValue("agent result");
    await store.seal(checkpoint.id);
    mocks.readTextFile.mockResolvedValue("user edit");
    await expect(store.restore(checkpoint.id)).rejects.toThrow("target changed");
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("does not promote a malformed checkpoint entry", async () => {
    localStorage.setItem(
      AGENT_CHECKPOINT_STORAGE_KEY,
      JSON.stringify([{ id: "broken", files: [{ path: "a.ts" }] }]),
    );

    const store = new AgentCheckpointStore();

    expect(store.listForTask("task-1")).toEqual([]);
    await expect(store.initialize()).rejects.toThrow("malformed");
    expect(localStorage.getItem(AGENT_CHECKPOINT_STORAGE_KEY)).not.toBeNull();
  });

  it("keeps the old primary list when checkpoint promotion fails", async () => {
    mocks.readTextFile.mockResolvedValue("const value = 1;");
    const store = new AgentCheckpointStore();
    const checkpoint = await store.capture("task-1", ["C:\\work\\main.ts"], "Before edit");
    const previous = mocks.stored.get("checkpoints");
    expect(previous).not.toBeNull();

    mocks.storageWrite.mockRejectedValueOnce(new Error("quota"));
    await expect(store.deleteForTask(checkpoint.taskId)).rejects.toThrow("quota");
    expect(mocks.stored.get("checkpoints")).toBe(previous);
    expect(store.get(checkpoint.id)).toBe(checkpoint);
  });
  it("keeps a restart recovery journal when rollback fails and rejects later changes", async () => {
    mocks.stored.set(
      "journal",
      JSON.stringify({
        schema: 1,
        checkpointId: "checkpoint-1",
        workspaceId: "single-file",
        originals: [{ path: "C:\\work\\a.ts", content: "before" }],
        targets: [{ path: "C:\\work\\a.ts", content: "restored" }],
      }),
    );
    const store = new AgentCheckpointStore();
    mocks.readTextFile.mockResolvedValue("user edit");
    await expect(store.recoverPendingRestore()).rejects.toThrow("recovery_conflict");
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
    expect(mocks.stored.get("journal")).not.toBe("null");
    mocks.readTextFile.mockResolvedValue("restored");
    await store.recoverPendingRestore();
    expect(mocks.writeTextFile).toHaveBeenCalledWith("C:\\work\\a.ts", "before");
    expect(mocks.stored.get("journal")).toBe("null");
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

import { webcrypto } from "node:crypto";

describe("Checkpoint recovery boundaries", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("crypto", webcrypto);
    mocks.stored.clear();
    mocks.generation.mockReset().mockResolvedValue(1);
    mocks.readTextFile.mockReset().mockResolvedValue("before");
    mocks.writeTextFile.mockReset();
    mocks.storageWrite
      .mockReset()
      .mockImplementation(async (slot: string, text: string) => mocks.stored.set(slot, text));
  });

  it("rejects malformed, mismatched and foreign-workspace journals before writing", async () => {
    const store = new AgentCheckpointStore();
    for (const journal of [
      {
        schema: 1,
        checkpointId: "c",
        workspaceId: "single-file",
        originals: [null],
        targets: [null],
      },
      {
        schema: 1,
        checkpointId: "c",
        workspaceId: "single-file",
        originals: [{ path: "a", content: "a" }],
        targets: [{ path: "b", content: "b" }],
      },
      { schema: 1, checkpointId: "c", workspaceId: "other", originals: [], targets: [] },
    ]) {
      const raw = JSON.stringify(journal);
      mocks.stored.set("journal", raw);
      await expect(store.recoverPendingRestore()).rejects.toThrow(
        /recovery_schema|recovery_workspace/,
      );
      expect(mocks.stored.get("journal")).toBe(raw);
    }
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("blocks edits while recovery is pending and rejects capture after a workspace switch", async () => {
    const store = new AgentCheckpointStore();
    mocks.stored.set("journal", "{}");
    await expect(store.capture("t", ["a"], "edit")).rejects.toThrow("recovery_pending");
    mocks.stored.set("journal", "null");
    mocks.generation.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await expect(store.capture("t", ["a"], "edit")).rejects.toThrow("generation");
    expect(store.listForTask("t")).toEqual([]);
  });

  it("serializes checkpoint mutation across store instances", async () => {
    let release: (content: string) => void = () => undefined;
    mocks.readTextFile.mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    );
    const pending = new AgentCheckpointStore().capture("t", ["a"], "edit");
    await expect(new AgentCheckpointStore().capture("t", ["b"], "edit")).rejects.toThrow(
      "recovery_busy",
    );
    release("before");
    await pending;
  });
});
