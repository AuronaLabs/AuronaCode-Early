import { beforeEach, describe, expect, it } from "vitest";
import { DiagnosticsService } from "./DiagnosticsService";

describe("DiagnosticsService lifecycle", () => {
  beforeEach(() => {
    DiagnosticsService.clear();
  });

  it("stores and removes documents by uri", () => {
    DiagnosticsService.update({
      uri: "file:///C:/repo/a.ts",
      diagnostics: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: "boom",
        },
      ],
    });
    expect(DiagnosticsService.get("file:///C:/repo/a.ts")?.diagnostics).toHaveLength(1);

    DiagnosticsService.update({
      uri: "file:///C:/repo/a.ts",
      diagnostics: [],
    });
    expect(DiagnosticsService.get("file:///C:/repo/a.ts")).toBeUndefined();
  });

  it("clears one uri or everything and bumps the revision", () => {
    const revisionBefore = DiagnosticsService.getRevision();
    DiagnosticsService.update({
      uri: "file:///C:/repo/a.ts",
      diagnostics: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: "a",
        },
      ],
    });
    DiagnosticsService.update({
      uri: "file:///C:/repo/b.ts",
      diagnostics: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: "b",
        },
      ],
    });

    DiagnosticsService.clear("file:///C:/repo/a.ts");
    expect(DiagnosticsService.get("file:///C:/repo/a.ts")).toBeUndefined();
    expect(DiagnosticsService.get("file:///C:/repo/b.ts")).toBeDefined();
    expect(DiagnosticsService.getRevision()).toBeGreaterThan(revisionBefore);

    DiagnosticsService.clear();
    expect(DiagnosticsService.getAll()).toHaveLength(0);
  });
});
