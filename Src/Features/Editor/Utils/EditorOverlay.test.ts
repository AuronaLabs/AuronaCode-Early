import { describe, expect, it } from "vitest";
import { positionEditorOverlay } from "./EditorOverlay";

describe("positionEditorOverlay", () => {
  it("anchors below a token when space is available", () => {
    expect(
      positionEditorOverlay(
        { left: 120, right: 160, top: 80, bottom: 100 },
        { width: 240, height: 120 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 120, top: 106, placement: "below" });
  });

  it("flips above and clamps horizontally near viewport edges", () => {
    expect(
      positionEditorOverlay(
        { left: 760, right: 790, top: 500, bottom: 520 },
        { width: 240, height: 160 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 552, top: 334, placement: "above" });
  });
});
