export type GlassIntensity = "light" | "medium" | "heavy";
export type GlassLayer = "base" | "raised" | "overlay";

export interface GlassConfig {
  intensity: GlassIntensity;
}

export interface GlassPreset {
  base: string;
  raised: string;
  overlay: string;
  opacityMultiplier: string;
}

export const LIGHT_GLASS_PRESETS: Record<GlassIntensity, GlassPreset> = {
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
};

// Dark surfaces need more blur separation to retain the same perceived depth.
// Keep these profiles explicit so tuning the light theme cannot silently alter
// the dark theme's established material strength.
export const DARK_GLASS_PRESETS: Record<GlassIntensity, GlassPreset> = {
  light: {
    base: "8px",
    raised: "16px",
    overlay: "24px",
    opacityMultiplier: "1.0",
  },
  medium: {
    base: "16px",
    raised: "24px",
    overlay: "40px",
    opacityMultiplier: "0.6",
  },
  heavy: {
    base: "24px",
    raised: "36px",
    overlay: "56px",
    opacityMultiplier: "0.42",
  },
};

export function getGlassPreset(intensity: GlassIntensity, isDark: boolean): GlassPreset {
  const presets = isDark ? DARK_GLASS_PRESETS : LIGHT_GLASS_PRESETS;
  return presets[intensity] ?? presets.medium;
}
