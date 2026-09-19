import { describe, expect, it } from "vitest";
import {
  DARK_GLASS_PRESETS,
  getGlassPreset,
  LIGHT_GLASS_PRESETS,
  legacyGlassIntensityToNumber,
  lerpGlassPreset,
  resolveContinuousPreset,
} from "./glassConfig";

describe("glass intensity profiles", () => {
  it("adds a softer light profile and shifts the existing profiles upward", () => {
    expect(LIGHT_GLASS_PRESETS).toEqual({
      light: {
        base: "2px",
        raised: "4px",
        overlay: "6px",
        opacityMultiplier: "1.15",
        shadowDepth: "0.06",
        saturation: "1.12",
        rimStrength: "0.7",
        borderLuminance: "0.7",
      },
      medium: {
        base: "4px",
        raised: "8px",
        overlay: "10px",
        opacityMultiplier: "1.05",
        shadowDepth: "0.09",
        saturation: "1.2",
        rimStrength: "0.85",
        borderLuminance: "0.8",
      },
      heavy: {
        base: "8px",
        raised: "16px",
        overlay: "18px",
        opacityMultiplier: "0.95",
        shadowDepth: "0.13",
        saturation: "1.3",
        rimStrength: "1",
        borderLuminance: "0.9",
      },
    });
  });

  it("keeps the calibrated dark profiles independent from light mode", () => {
    expect(DARK_GLASS_PRESETS.light).toEqual({
      base: "8px",
      raised: "16px",
      overlay: "18px",
      opacityMultiplier: "1.0",
      shadowDepth: "0.1",
      saturation: "1.12",
      rimStrength: "0.7",
      borderLuminance: "0.7",
    });
    expect(DARK_GLASS_PRESETS.medium).toEqual({
      base: "16px",
      raised: "24px",
      overlay: "32px",
      opacityMultiplier: "0.6",
      shadowDepth: "0.15",
      saturation: "1.2",
      rimStrength: "0.85",
      borderLuminance: "0.8",
    });
  });

  it("provides a stronger new dark heavy profile", () => {
    expect(getGlassPreset("heavy", true)).toEqual({
      base: "24px",
      raised: "36px",
      overlay: "44px",
      opacityMultiplier: "0.55",
      shadowDepth: "0.2",
      saturation: "1.3",
      rimStrength: "1",
      borderLuminance: "0.9",
    });
  });

  it("keeps multi-axis tokens monotonic across intensity tiers (Aurona 玻璃效果档位递进)", () => {
    const tiers = ["light", "medium", "heavy"] as const;
    for (const isDark of [false, true]) {
      const presets = tiers.map((tier) => getGlassPreset(tier, isDark));
      for (let index = 1; index < presets.length; index += 1) {
        const previous = presets[index - 1];
        const current = presets[index];
        expect(Number(current.shadowDepth)).toBeGreaterThanOrEqual(Number(previous.shadowDepth));
        expect(Number(current.saturation)).toBeGreaterThanOrEqual(Number(previous.saturation));
        expect(Number(current.rimStrength)).toBeGreaterThanOrEqual(Number(previous.rimStrength));
        expect(Number(current.borderLuminance)).toBeGreaterThanOrEqual(
          Number(previous.borderLuminance),
        );
      }
    }
  });
});

describe("continuous glass intensity (0-100)", () => {
  it("keeps the three tiers as exact anchors of the continuous range", () => {
    expect(resolveContinuousPreset(0, "light")).toEqual(LIGHT_GLASS_PRESETS.light);
    expect(resolveContinuousPreset(50, "light")).toEqual(LIGHT_GLASS_PRESETS.medium);
    expect(resolveContinuousPreset(100, "light")).toEqual(LIGHT_GLASS_PRESETS.heavy);
    expect(resolveContinuousPreset(0, "dark")).toEqual(DARK_GLASS_PRESETS.light);
    expect(resolveContinuousPreset(50, "dark")).toEqual(DARK_GLASS_PRESETS.medium);
    expect(resolveContinuousPreset(100, "dark")).toEqual(DARK_GLASS_PRESETS.heavy);
  });

  it("lerps every axis monotonically between adjacent anchors", () => {
    const mid = resolveContinuousPreset(25, "light");
    expect(mid.base).toBe("3px");
    expect(mid.rimStrength).toBe("0.775");
    expect(Number(mid.saturation)).toBeGreaterThan(Number(LIGHT_GLASS_PRESETS.light.saturation));
    expect(Number(mid.saturation)).toBeLessThan(Number(LIGHT_GLASS_PRESETS.medium.saturation));
    // lerp 端点与钳制
    expect(lerpGlassPreset(LIGHT_GLASS_PRESETS.light, LIGHT_GLASS_PRESETS.medium, -1)).toEqual(
      LIGHT_GLASS_PRESETS.light,
    );
    expect(lerpGlassPreset(LIGHT_GLASS_PRESETS.light, LIGHT_GLASS_PRESETS.medium, 2)).toEqual(
      LIGHT_GLASS_PRESETS.medium,
    );
  });

  it("clamps out-of-range intensities to the anchor presets", () => {
    expect(resolveContinuousPreset(-5, "light")).toEqual(LIGHT_GLASS_PRESETS.light);
    expect(resolveContinuousPreset(150, "dark")).toEqual(DARK_GLASS_PRESETS.heavy);
  });

  it("migrates legacy tier strings to the 0-100 scale", () => {
    expect(legacyGlassIntensityToNumber("light")).toBe(0);
    expect(legacyGlassIntensityToNumber("medium")).toBe(50);
    expect(legacyGlassIntensityToNumber("balanced")).toBe(50);
    expect(legacyGlassIntensityToNumber("heavy")).toBe(100);
    expect(legacyGlassIntensityToNumber("rich")).toBe(100);
  });
});
