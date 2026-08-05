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

vi.mock("../Foundation/IPC/EditorCommands", () => ({
  EditorIPC: {
    open: mocks.open,
    applyEdits: mocks.applyEdits,
    save: mocks.save,
    close: mocks.close,
  },
}));

vi.mock("./Language/LspClient", () => ({
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

import { DocumentService } from "./DocumentService";

describe("DocumentService", () => {
  beforeEach(() => {
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

  it("uses the acknowledged editor revision for LSP synchronization", async () => {
    const path = "C:\\work\\main.ts";
    await DocumentService.open(path);
    await DocumentService.applyEdit(path, 14, 15, "2", "const value = 2;");

    expect(DocumentService.get(path)).toMatchObject({
      content: "const value = 2;",
      version: 1,
      isDirty: true,
    });
    expect(mocks.didChange).toHaveBeenCalledWith("typescript", path, "const value = 2;", 1);
    await DocumentService.close(path, true);
  });
});
