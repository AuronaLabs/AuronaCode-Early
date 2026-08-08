import { beforeEach, describe, expect, it } from "vitest";
import { setPathPlatform } from "../Shared/Utils/UriUtils";
import { collectProblems, DiagnosticsService } from "./DiagnosticsService";

describe("DiagnosticsService lifecycle", () => {
  beforeEach(() => {
    setPathPlatform("windows");
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

  it("collects workspace problems for every file", () => {
    DiagnosticsService.update({
      uri: "file:///C:/repo/a.ts",
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 1,
          message: "a-error",
        },
        {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
          severity: 2,
          message: "a-warning",
        },
      ],
    });
    DiagnosticsService.update({
      uri: "file:///C:/repo/b.ts",
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 1,
          message: "b-error",
        },
      ],
    });

    const workspace = collectProblems(DiagnosticsService.getAll(), "workspace", "C:\\repo\\a.ts");
    expect(workspace).toHaveLength(3);
    expect(workspace.some((problem) => problem.message === "b-error")).toBe(true);

    const fileOnly = collectProblems(DiagnosticsService.getAll(), "file", "C:\\repo\\a.ts");
    expect(fileOnly).toHaveLength(2);
    expect(fileOnly.every((problem) => problem.message.startsWith("a-"))).toBe(true);
  });

  it("returns no file-scope problems when no file is active", () => {
    DiagnosticsService.update({
      uri: "file:///C:/repo/a.ts",
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: "a-error",
        },
      ],
    });
    expect(collectProblems(DiagnosticsService.getAll(), "file", null)).toHaveLength(0);
  });
});
