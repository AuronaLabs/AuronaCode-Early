import { describe, expect, it } from "vitest";
import { DARK_GLASS_PRESETS, getGlassPreset, LIGHT_GLASS_PRESETS } from "./glassConfig";

describe("glass intensity profiles", () => {
  it("adds a softer light profile and shifts the existing profiles upward", () => {
    expect(LIGHT_GLASS_PRESETS).toEqual({
      light: { base: "2px", elevated: "4px", floating: "8px", opacityMultiplier: "1.35" },
      medium: { base: "4px", elevated: "8px", floating: "12px", opacityMultiplier: "1.2" },
      heavy: { base: "8px", elevated: "16px", floating: "24px", opacityMultiplier: "1.0" },
    });
  });

  it("keeps the calibrated dark profiles independent from light mode", () => {
    expect(DARK_GLASS_PRESETS.light).toEqual({
      base: "8px",
      elevated: "16px",
      floating: "24px",
      opacityMultiplier: "1.0",
    });
    expect(DARK_GLASS_PRESETS.medium).toEqual({
      base: "16px",
      elevated: "24px",
      floating: "40px",
      opacityMultiplier: "0.6",
    });
  });

  it("provides a stronger new dark heavy profile", () => {
    expect(getGlassPreset("heavy", true)).toEqual({
      base: "24px",
      elevated: "36px",
      floating: "56px",
      opacityMultiplier: "0.42",
    });
  });
});
