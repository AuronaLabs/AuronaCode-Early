import { describe, expect, it } from "vitest";
import type { FliunoCoreResult } from "./FliunoCore";
import { flattenFliunoPresentation } from "./presentation";

const result = (id: string, kind: FliunoCoreResult["kind"], path?: string): FliunoCoreResult => ({
  id,
  kind,
  title: id,
  description: "",
  score: 100,
  recent: false,
  titleRanges: [],
  descriptionRanges: [],
  action:
    kind === "file" || kind === "content" || kind === "symbol" ? "revealContent" : "openSettings",
  targetPath: path,
});

describe("flattenFliunoPresentation", () => {
  it("flattens mixed results in visual section order", () => {
    const presentation = flattenFliunoPresentation([
      result("file:z.ts", "file", "z.ts"),
      result("command:save", "command"),
      result("setting:theme", "setting"),
      result("symbol:s", "symbol", "s.ts"),
    ]);
    expect(presentation.display.map((item) => item.kind)).toEqual([
      "command",
      "file",
      "setting",
      "symbol",
    ]);
  });

  it("keeps content grouped by file with core order inside each group", () => {
    const presentation = flattenFliunoPresentation([
      result("content:b2", "content", "b.ts"),
      result("content:a1", "content", "a.ts"),
      result("content:b1", "content", "b.ts"),
    ]);
    expect(presentation.contentGroups.map((group) => group.path)).toEqual(["b.ts", "a.ts"]);
    expect(presentation.contentGroups[0]?.items.map((item) => item.id)).toEqual([
      "content:b2",
      "content:b1",
    ]);
    expect(presentation.indexById.get("content:a1")).toBe(2);
  });

  it("provides stable indices shared by rendering and keyboard navigation", () => {
    const presentation = flattenFliunoPresentation([
      result("command:save", "command"),
      result("file:z.ts", "file", "z.ts"),
    ]);
    expect(presentation.display[0]?.id).toBe("command:save");
    expect(presentation.indexById.get("command:save")).toBe(0);
    expect(presentation.indexById.get("file:z.ts")).toBe(1);
  });
});
