import { describe, expect, it } from "vitest";
import { DARK_GLASS_PRESETS, getGlassPreset, LIGHT_GLASS_PRESETS } from "./glassConfig";

describe("glass intensity profiles", () => {
  it("adds a softer light profile and shifts the existing profiles upward", () => {
    expect(LIGHT_GLASS_PRESETS).toEqual({
      light: {
        base: "2px",
        raised: "4px",
        overlay: "8px",
        opacityMultiplier: "1.15",
      },
      medium: {
        base: "4px",
        raised: "8px",
        overlay: "12px",
        opacityMultiplier: "1.05",
      },
      heavy: {
        base: "8px",
        raised: "16px",
        overlay: "24px",
        opacityMultiplier: "0.95",
      },
    });
  });

  it("keeps the calibrated dark profiles independent from light mode", () => {
    expect(DARK_GLASS_PRESETS.light).toEqual({
      base: "8px",
      raised: "16px",
      overlay: "24px",
      opacityMultiplier: "1.0",
    });
    expect(DARK_GLASS_PRESETS.medium).toEqual({
      base: "16px",
      raised: "24px",
      overlay: "40px",
      opacityMultiplier: "0.6",
    });
  });

  it("provides a stronger new dark heavy profile", () => {
    expect(getGlassPreset("heavy", true)).toEqual({
      base: "24px",
      raised: "36px",
      overlay: "56px",
      opacityMultiplier: "0.55",
    });
  });
});
