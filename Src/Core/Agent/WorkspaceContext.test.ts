import { describe, expect, it } from "vitest";
import { WorkspaceContextService } from "./WorkspaceContext";

describe("WorkspaceContextService", () => {
  it("returns a stable workspace context shape without indexing files", () => {
    const context = WorkspaceContextService.getContext();
    expect(context.projectRoot === null || typeof context.projectRoot === "string").toBe(true);
    expect(context.activeFile === null || typeof context.activeFile === "string").toBe(true);
    expect(context.openedFiles).toEqual(expect.any(Array));
    expect(context.language).toEqual(expect.any(String));
    expect(context.selection).toEqual(expect.any(String));
    expect(context.cursor).toEqual({ line: expect.any(Number), column: expect.any(Number) });
    expect(context.diagnostics).toEqual(expect.any(Array));
    expect(context.recentChanges).toEqual(expect.any(Array));
  });
});
