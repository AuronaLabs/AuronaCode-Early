import { beforeEach, describe, expect, it } from "vitest";
import { clearWorkspaceLocalState, STORAGE_OWNERSHIP } from "./storageOwnership";

describe("storage ownership", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("declares which keys are workspace-owned and which are global", () => {
    expect(STORAGE_OWNERSHIP.workspace).toEqual([]);
    expect(STORAGE_OWNERSHIP.appGlobal).toContain("aurona.locale");
    expect(STORAGE_OWNERSHIP.appGlobal).toContain("aurona.fliuno.recent.v1");
    expect(STORAGE_OWNERSHIP.appGlobal).toContain("aurona.fliuno.files.recent.v1");
  });

  it("workspace cleanup never removes global locale or Fliuno history", () => {
    localStorage.setItem("aurona.locale", "en");
    localStorage.setItem("aurona.fliuno.recent.v1", '["workbench.action.openSettings"]');
    localStorage.setItem("aurona.fliuno.files.recent.v1", '["C:/repo/main.ts"]');
    localStorage.setItem("aurona.commandPalette.recent.v1", '["old"]');

    clearWorkspaceLocalState();

    expect(localStorage.getItem("aurona.locale")).toBe("en");
    expect(localStorage.getItem("aurona.fliuno.recent.v1")).toBe(
      '["workbench.action.openSettings"]',
    );
    expect(localStorage.getItem("aurona.fliuno.files.recent.v1")).toBe('["C:/repo/main.ts"]');
    expect(localStorage.getItem("aurona.commandPalette.recent.v1")).toBe('["old"]');
  });
});
