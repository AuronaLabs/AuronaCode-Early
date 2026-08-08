import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({}),
}));

const mocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(async (_path: string, _content: string) => undefined),
  documentGet: vi.fn(),
  applyEdits: vi.fn(async (_path: string, _edits: unknown[], _content: string) => undefined),
  emit: vi.fn(),
}));

vi.mock("../Foundation/IPC/FileSystemCommands", () => ({
  FileSystemCommands: {
    readTextFile: mocks.readTextFile,
    writeTextFile: mocks.writeTextFile,
  },
}));

vi.mock("../Foundation/EventBus", () => ({
  EventBus: {
    emit: mocks.emit,
  },
}));

vi.mock("./DocumentService", () => ({
  DocumentService: {
    get: mocks.documentGet,
    applyEdits: mocks.applyEdits,
  },
}));

import { LanguageFeatureService, type WorkspaceEdit } from "./LanguageFeatureService";

const TEXT = "const alpha = 1;\nconst beta = 2;\nconst alpha = 3;\n";
const openDocument = (content: string, version = 1) => ({
  path: "C:\\repo\\a.ts",
  languageId: "typescript",
  content,
  version,
  savedVersion: 1,
  isDirty: false,
  isReadonly: false,
  encoding: "UTF-8",
  lineEnding: "LF",
  openState: "open",
  saveState: "idle",
  diskFingerprint: "disk",
});

const alphaEdits = [
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    newText: "let",
  },
  {
    range: { start: { line: 2, character: 6 }, end: { line: 2, character: 11 } },
    newText: "beta",
  },
];

const multiFileEdit: WorkspaceEdit = {
  documentChanges: [
    {
      textDocument: { uri: "file:///C:/repo/a.ts", version: 1 },
      edits: alphaEdits,
    },
  ],
};

const twoFileEdit: WorkspaceEdit = {
  documentChanges: [
    { textDocument: { uri: "file:///C:/repo/a.ts" }, edits: alphaEdits },
    {
      textDocument: { uri: "file:///C:/repo/b.ts" },
      edits: [
        {
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
          newText: "gamma",
        },
      ],
    },
  ],
};

describe("LanguageFeatureService preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documentGet.mockReturnValue(openDocument(TEXT));
  });

  it("builds a rich workspace edit preview from the open document", async () => {
    const preview = await LanguageFeatureService.previewWorkspaceEdit(multiFileEdit);

    expect(preview.totalEdits).toBe(2);
    expect(preview.files).toHaveLength(1);
    expect(preview.files[0]?.uri).toBe("file:///C:/repo/a.ts");
    expect(preview.files[0]?.edits).toEqual([
      { line: 1, oldText: "const", newText: "let" },
      { line: 3, oldText: "alpha", newText: "beta" },
    ]);
    expect(mocks.readTextFile).not.toHaveBeenCalled();
    expect(preview.fingerprints["C:\\repo\\a.ts"]).toBeTruthy();
  });

  it("falls back to reading the file when the document is not open", async () => {
    mocks.documentGet.mockReturnValue(undefined);
    mocks.readTextFile.mockResolvedValue(TEXT);

    const preview = await LanguageFeatureService.previewWorkspaceEdit(multiFileEdit);

    expect(mocks.readTextFile).toHaveBeenCalledWith("C:\\repo\\a.ts");
    expect(preview.files[0]?.edits[0]).toEqual({
      line: 1,
      oldText: "const",
      newText: "let",
    });
    expect(preview.fingerprints["C:\\repo\\a.ts"]).toBeTruthy();
  });

  it("returns null for code actions without edits and previews edits when present", async () => {
    const withoutEdit = await LanguageFeatureService.previewCodeAction("typescript", {
      title: "Refactor",
    });
    expect(withoutEdit).toBeNull();

    const withEdit = await LanguageFeatureService.previewCodeAction("typescript", {
      title: "Inline variable",
      edit: multiFileEdit,
    });
    expect(withEdit?.preview.totalEdits).toBe(2);
  });

  it("rejects disabled code actions with their reason", async () => {
    await expect(
      LanguageFeatureService.previewCodeAction("typescript", {
        title: "Unavailable",
        disabled: { reason: "not supported here" },
      }),
    ).rejects.toThrow("not supported here");
  });
});

describe("LanguageFeatureService apply workspace edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies edits to a single open document through the editor session", async () => {
    mocks.documentGet.mockReturnValue(openDocument(TEXT));

    await LanguageFeatureService.applyWorkspaceEdit(multiFileEdit);

    expect(mocks.applyEdits).toHaveBeenCalledOnce();
    expect(mocks.applyEdits.mock.calls[0]?.[0]).toBe("C:\\repo\\a.ts");
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("applies edits to multiple open documents", async () => {
    mocks.documentGet.mockImplementation((path: string) =>
      path === "C:\\repo\\a.ts"
        ? openDocument(TEXT)
        : openDocument("const beta = 2;\nconst alpha = 3;\n", 1),
    );

    await LanguageFeatureService.applyWorkspaceEdit(twoFileEdit);

    expect(mocks.applyEdits).toHaveBeenCalledTimes(2);
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("applies mixed open and closed documents", async () => {
    mocks.documentGet.mockImplementation((path: string) =>
      path === "C:\\repo\\a.ts" ? openDocument(TEXT) : undefined,
    );
    mocks.readTextFile.mockResolvedValue("const beta = 2;\n");

    await LanguageFeatureService.applyWorkspaceEdit(twoFileEdit);

    expect(mocks.applyEdits).toHaveBeenCalledTimes(1);
    expect(mocks.writeTextFile).toHaveBeenCalledWith("C:\\repo\\b.ts", "const gamma = 2;\n");
    expect(mocks.emit).toHaveBeenCalledWith("fs:changed", {
      type: "modified",
      paths: ["C:\\repo\\b.ts"],
    });
  });

  it("applies edits to fully closed documents and writes them safely", async () => {
    mocks.documentGet.mockReturnValue(undefined);
    mocks.readTextFile.mockImplementation((path: string) =>
      Promise.resolve(path === "C:\\repo\\a.ts" ? TEXT : "const beta = 2;\n"),
    );

    await LanguageFeatureService.applyWorkspaceEdit(twoFileEdit);

    expect(mocks.writeTextFile).toHaveBeenCalledTimes(2);
    expect(mocks.writeTextFile.mock.calls[0]?.[1]).toBe(
      "let alpha = 1;\nconst beta = 2;\nconst beta = 3;\n",
    );
    expect(mocks.writeTextFile.mock.calls[1]?.[1]).toBe("const gamma = 2;\n");
    expect(mocks.applyEdits).not.toHaveBeenCalled();
  });

  it("rejects when a closed document changed on disk since preview", async () => {
    mocks.documentGet.mockReturnValue(undefined);
    mocks.readTextFile.mockResolvedValueOnce(TEXT);
    const preview = await LanguageFeatureService.previewWorkspaceEdit(multiFileEdit);

    mocks.readTextFile.mockResolvedValueOnce(
      "const alpha = 1;\nconst beta = 999;\nconst alpha = 3;\n",
    );
    await expect(
      LanguageFeatureService.applyWorkspaceEditWithFingerprints(
        multiFileEdit,
        preview.fingerprints,
      ),
    ).rejects.toThrow("changed since preview");
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
    expect(mocks.applyEdits).not.toHaveBeenCalled();
  });

  it("rejects version mismatches before touching any document", async () => {
    mocks.documentGet.mockReturnValue(openDocument(TEXT, 3));

    await expect(LanguageFeatureService.applyWorkspaceEdit(multiFileEdit)).rejects.toThrow(
      "version mismatch",
    );
    expect(mocks.applyEdits).not.toHaveBeenCalled();
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("never reports success silently when a later write fails", async () => {
    mocks.documentGet.mockReturnValue(undefined);
    mocks.readTextFile.mockResolvedValue(TEXT);
    mocks.writeTextFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"));

    await expect(LanguageFeatureService.applyWorkspaceEdit(twoFileEdit)).rejects.toThrow(
      "disk full",
    );
    expect(mocks.writeTextFile).toHaveBeenCalledTimes(2);
  });

  it("applies UTF-16 ranges with Chinese and emoji correctly", async () => {
    const content = "😀let x = 1;\nlet 測試 = 2;\n";
    mocks.documentGet.mockReturnValue(openDocument(content));
    const edit: WorkspaceEdit = {
      documentChanges: [
        {
          textDocument: { uri: "file:///C:/repo/a.ts", version: 1 },
          edits: [
            {
              range: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } },
              newText: "var",
            },
            {
              range: { start: { line: 1, character: 4 }, end: { line: 1, character: 6 } },
              newText: "常數",
            },
          ],
        },
      ],
    };

    await LanguageFeatureService.applyWorkspaceEdit(edit);

    const appliedContent = mocks.applyEdits.mock.calls[0]?.[2];
    expect(appliedContent).toBe("😀var x = 1;\nlet 常數 = 2;\n");
  });

  it("rejects conflicting versions when the same file appears twice", async () => {
    mocks.documentGet.mockReturnValue(openDocument(TEXT));
    const edit: WorkspaceEdit = {
      documentChanges: [
        { textDocument: { uri: "file:///C:/repo/a.ts", version: 1 }, edits: [] },
        { textDocument: { uri: "file:///C:/repo/a.ts", version: 2 }, edits: [] },
      ],
    };

    await expect(LanguageFeatureService.applyWorkspaceEdit(edit)).rejects.toThrow(
      "version mismatch",
    );
    expect(mocks.applyEdits).not.toHaveBeenCalled();
  });

  it("reports unsupported resource operations without stale version numbers", async () => {
    mocks.documentGet.mockReturnValue(openDocument(TEXT));
    const edit: WorkspaceEdit = {
      documentChanges: [{ kind: "rename" }],
    };

    await expect(LanguageFeatureService.applyWorkspaceEdit(edit)).rejects.toThrow(
      "Workspace resource operation is not supported yet: rename",
    );
  });
});
