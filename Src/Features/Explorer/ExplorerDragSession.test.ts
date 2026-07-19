import { afterEach, describe, expect, it } from "vitest";
import { ExplorerDragSession } from "./ExplorerDragSession";

describe("ExplorerDragSession", () => {
  afterEach(() => ExplorerDragSession.end());

  it("falls back to the in-memory path when WebView omits custom drag data", () => {
    ExplorerDragSession.begin("C:\\workspace\\file.ts");
    const transfer = { getData: () => "" } as unknown as DataTransfer;
    expect(ExplorerDragSession.read(transfer)).toBe("C:\\workspace\\file.ts");
  });

  it("clears the active path after a drag ends", () => {
    ExplorerDragSession.begin("/workspace/file.ts");
    ExplorerDragSession.end();
    expect(ExplorerDragSession.read({ getData: () => "" } as unknown as DataTransfer)).toBeNull();
  });
});
