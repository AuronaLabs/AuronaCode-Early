import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({}),
}));

const mocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  documentGet: vi.fn(),
}));

vi.mock("../Foundation/IPC/FileSystemCommands", () => ({
  FileSystemCommands: {
    readTextFile: mocks.readTextFile,
  },
}));

vi.mock("./DocumentService", () => ({
  DocumentService: {
    get: mocks.documentGet,
  },
}));

import { LanguageFeatureService, type WorkspaceEdit } from "./LanguageFeatureService";

const TEXT = "const alpha = 1;\nconst beta = 2;\nconst alpha = 3;\n";

const multiFileEdit: WorkspaceEdit = {
  documentChanges: [
    {
      textDocument: { uri: "file:///C:/repo/a.ts", version: 1 },
      edits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          newText: "let",
        },
        {
          range: { start: { line: 2, character: 6 }, end: { line: 2, character: 11 } },
          newText: "beta",
        },
      ],
    },
  ],
};

describe("LanguageFeatureService preview", () => {
  beforeEach(() => {
    mocks.readTextFile.mockReset();
    mocks.documentGet.mockReset();
  });

  it("builds a rich workspace edit preview from the open document", async () => {
    mocks.documentGet.mockReturnValue({ content: TEXT });

    const preview = await LanguageFeatureService.previewWorkspaceEdit(multiFileEdit);

    expect(preview.totalEdits).toBe(2);
    expect(preview.files).toHaveLength(1);
    expect(preview.files[0]?.uri).toBe("file:///C:/repo/a.ts");
    expect(preview.files[0]?.edits).toEqual([
      { line: 1, oldText: "const", newText: "let" },
      { line: 3, oldText: "alpha", newText: "beta" },
    ]);
    expect(mocks.readTextFile).not.toHaveBeenCalled();
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
  });

  it("returns null for code actions without edits and previews edits when present", async () => {
    const withoutEdit = await LanguageFeatureService.previewCodeAction("typescript", {
      title: "Refactor",
    });
    expect(withoutEdit).toBeNull();

    mocks.documentGet.mockReturnValue({ content: TEXT });
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
