import { afterEach, describe, expect, it } from "vitest";
import { ExplorerDragSession, FILE_NODE_MIME } from "./ExplorerDragSession";

describe("ExplorerDragSession", () => {
  afterEach(() => ExplorerDragSession.end());

  it("reads the internal file-node MIME payload", () => {
    ExplorerDragSession.begin("C:\\workspace\\file.ts");
    const transfer = {
      getData: (type: string) => (type === FILE_NODE_MIME ? "C:\\workspace\\file.ts" : ""),
    } as unknown as DataTransfer;
    expect(ExplorerDragSession.read(transfer)).toBe("C:\\workspace\\file.ts");
  });

  it("falls back to the in-memory path when WebView omits custom drag data", () => {
    ExplorerDragSession.begin("C:\\workspace\\file.ts");
    const transfer = { getData: () => "" } as unknown as DataTransfer;
    expect(ExplorerDragSession.read(transfer)).toBe("C:\\workspace\\file.ts");
  });

  it("never accepts external text/plain payloads as file moves", () => {
    const transfer = {
      getData: (type: string) => (type === "text/plain" ? "E:\\external.txt" : ""),
    } as unknown as DataTransfer;
    expect(ExplorerDragSession.read(transfer)).toBeNull();
  });

  it("clears the active path after a drag ends", () => {
    ExplorerDragSession.begin("/workspace/file.ts");
    ExplorerDragSession.end();
    expect(ExplorerDragSession.read({ getData: () => "" } as unknown as DataTransfer)).toBeNull();
  });
});
