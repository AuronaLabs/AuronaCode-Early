import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TabItem } from "../../../Foundation/Types/Tab";
import type { DocumentEvent, DocumentRecord } from "../../Documents";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  flush: vi.fn(),
  edits: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("../../Documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../Documents")>()),
  DocumentService: {
    get: mocks.get,
    flush: mocks.flush,
    applyEdits: mocks.edits,
    subscribeEvents: mocks.subscribe,
  },
}));

import { createAuronaSDKHost, type ExtensionHostPorts } from "./AuronaSDKHost";

const record: DocumentRecord = {
  path: "C:/work/file.ts",
  languageId: "typescript",
  content: "first\r\nold tail\r\nend",
  version: 7,
  savedVersion: 7,
  isDirty: false,
  isReadonly: false,
  encoding: "UTF-8",
  lineEnding: "CRLF",
  openState: "open",
  saveState: "idle",
  diskFingerprint: "saved",
};
const file: TabItem = { id: "file", type: "file", title: "file.ts", path: record.path };
function ports(tabs: TabItem[] = [file], activeTabId = "file"): ExtensionHostPorts {
  return {
    workbench: () => ({ tabs, activeTabId }),
    openFile: vi.fn(),
    showOutput: vi.fn(),
    notify: vi.fn(),
    quickPick: vi.fn().mockResolvedValue(undefined),
    inputBox: vi.fn().mockResolvedValue(undefined),
  };
}
describe("SDK document and resource contracts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockReturnValue(record);
    mocks.flush.mockResolvedValue(undefined);
    mocks.edits.mockResolvedValue(undefined);
  });
  it("applies multiline edits against the confirmed snapshot and its revision", async () => {
    const sdk = createAuronaSDKHost("sample.demo", ports());
    try {
      await expect(
        sdk.workspace.applyEdits([
          { range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 4 }, newText: "short" },
        ]),
      ).resolves.toBe(true);
      expect(mocks.flush).toHaveBeenCalledWith(record.path);
      expect(mocks.edits).toHaveBeenCalledWith(
        record.path,
        [{ startUtf16: 0, endUtf16: record.content.length, text: "short" }],
        "short",
        "external",
        7,
      );
    } finally {
      sdk.dispose();
    }
  });
  it("exposes only file tabs as documents", () => {
    const diff: TabItem = { id: "diff", type: "diff", title: "Diff", path: record.path };
    const sdk = createAuronaSDKHost("sample.demo", ports([file, diff], "diff"));
    try {
      expect(sdk.workspace.getActiveDocument()).toBeNull();
      expect(sdk.workspace.getOpenDocuments().map((doc) => doc.path)).toEqual([record.path]);
    } finally {
      sdk.dispose();
    }
  });
  it("dispatches semantic document events and removes all subscriptions over 20 lifecycles", () => {
    const listeners = new Set<(event: DocumentEvent) => void>();
    mocks.subscribe.mockImplementation((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    for (let cycle = 0; cycle < 20; cycle++) {
      const sdk = createAuronaSDKHost("sample.demo", ports());
      const opened = vi.fn(),
        changed = vi.fn(),
        saved = vi.fn(),
        closed = vi.fn();
      sdk.workspace.onDidOpenTextDocument(opened);
      sdk.workspace.onDidChangeTextDocument(changed);
      sdk.workspace.onDidSaveTextDocument(saved);
      sdk.workspace.onDidCloseTextDocument(closed);
      expect(listeners.size).toBe(4);
      for (const type of ["opened", "changed", "saved", "closed"] as const)
        for (const listener of listeners) listener({ type, document: record });
      expect(opened).toHaveBeenCalledOnce();
      expect(changed).toHaveBeenCalledOnce();
      expect(saved).toHaveBeenCalledOnce();
      expect(closed).toHaveBeenCalledWith(record.path);
      sdk.dispose();
      sdk.dispose();
      expect(listeners.size).toBe(0);
    }
  });
});
