const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  applyEdits: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
  didOpen: vi.fn(),
  didChange: vi.fn(),
  didSave: vi.fn(),
  didClose: vi.fn(),
}));

vi.mock("../../Foundation/IPC/EditorCommands", () => ({
  EditorIPC: {
    open: mocks.open,
    applyEdits: mocks.applyEdits,
    save: mocks.save,
    close: mocks.close,
    waitForIdle: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../Language/LspClient", () => ({
  LspClient: {
    getInstance: () => ({
      didOpen: mocks.didOpen,
      didChange: mocks.didChange,
      didSave: mocks.didSave,
      didClose: mocks.didClose,
      getKnownFileUri: () => "file:///C:/work/main.ts",
    }),
  },
}));

import { documentLanguageAdapter } from "../../App/Bootstrap/DocumentLanguageAdapter";
import { DocumentService } from "./index";

describe("DocumentService", () => {
  it("flushes and saves text while language synchronization is stalled", async () => {
    let release!: () => void;
    mocks.didOpen.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    const path = "C:\\work\\main.ts";
    await DocumentService.open(path);
    try {
      await DocumentService.flush(path);
      await DocumentService.save(path);
      expect(mocks.save).toHaveBeenCalledWith(path);
    } finally {
      release();
    }
  });
  beforeEach(() => {
    DocumentService.registerLanguageSync(documentLanguageAdapter);
    vi.clearAllMocks();
    mocks.open.mockResolvedValue({
      path: "C:\\work\\main.ts",
      revision: 0,
      savedRevision: 0,
      text: "const value = 1;",
      lineEnding: "lf",
      language: "typescript",
      lineCount: 1,
      diskFingerprint: "fingerprint",
    });
    mocks.applyEdits.mockResolvedValue({ revision: 1, lineCount: 1, dirty: true });
    mocks.save.mockResolvedValue({ revision: 1, diskFingerprint: "saved" });
    mocks.close.mockResolvedValue(undefined);
    mocks.didOpen.mockResolvedValue(undefined);
    mocks.didChange.mockResolvedValue(undefined);
    mocks.didSave.mockResolvedValue(undefined);
    mocks.didClose.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await DocumentService.closeAll(true);
  });

  it("uses the acknowledged editor revision for LSP synchronization", async () => {
    const path = "C:\\work\\main.ts";
    await DocumentService.open(path);
    await DocumentService.applyEdit(path, 14, 15, "2", "const value = 2;");

    expect(DocumentService.get(path)).toMatchObject({
      content: "const value = 2;",
      version: 1,
      isDirty: true,
      changeOrigin: "local",
    });
    // didChange 透传编辑区间（增量 LSP 同步用）
    expect(mocks.didChange).toHaveBeenCalledWith("typescript", path, "const value = 2;", 1, [
      { startUtf16: 14, endUtf16: 15, text: "2" },
    ]);
    await DocumentService.close(path, true);
  });

  it("keeps external edit notifications distinguishable from local typing", async () => {
    const path = "C:\\work\\main.ts";
    await DocumentService.open(path);
    await DocumentService.applyEdits(path, [], "const value = 3;", "external");

    expect(DocumentService.get(path)?.changeOrigin).toBe("external");
    await DocumentService.close(path, true);
  });
  it("deduplicates an opening but orders a reopen after a queued close", async () => {
    const path = "C:\\work\\main.ts";
    const first = DocumentService.open(path);
    const duplicate = DocumentService.open(path);
    expect(first).toBe(duplicate);
    const close = DocumentService.close(path, true);
    const reopened = DocumentService.open(path);
    await Promise.all([first, close, reopened]);
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(DocumentService.get(path)?.openState).toBe("open");
  });

  it("saves acknowledged edits while later typing stays dirty", async () => {
    const path = "C:\\work\\main.ts";
    await DocumentService.open(path);
    mocks.applyEdits
      .mockResolvedValueOnce({ revision: 1, dirty: true })
      .mockResolvedValueOnce({ revision: 2, dirty: true });
    let complete: (value: { revision: number; diskFingerprint: string }) => void = () => undefined;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const edit = DocumentService.applyEdits(path, [], "first");
    const saving = DocumentService.save(path);
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    const later = DocumentService.applyEdits(path, [], "later");
    complete({ revision: 1, diskFingerprint: "saved" });
    await Promise.all([edit, saving, later]);
    expect(DocumentService.get(path)).toMatchObject({
      content: "later",
      savedContent: "first",
      version: 2,
      savedVersion: 1,
      isDirty: true,
    });
  });

  it("does not block close behind a stalled optional language server", async () => {
    const path = "C:\\work\\main.ts";
    let finishLanguage: () => void = () => undefined;
    mocks.didOpen.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLanguage = resolve;
        }),
    );
    await DocumentService.open(path);
    await DocumentService.close(path, true);
    expect(DocumentService.get(path)).toBeUndefined();
    finishLanguage();
    await vi.waitFor(() => expect(mocks.didClose).toHaveBeenCalled());
  });

  it("keeps a document usable when close is rejected", async () => {
    const path = "C:\\work\\main.ts";
    await DocumentService.open(path);
    mocks.close.mockRejectedValueOnce(new Error("unsaved document"));
    await expect(DocumentService.close(path)).rejects.toThrow("unsaved");
    expect(DocumentService.get(path)?.openState).toBe("open");
    await DocumentService.applyEdits(path, [], "still editable");
    expect(DocumentService.get(path)?.content).toBe("still editable");
  });
});
