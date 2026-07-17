export type GlassIntensity = "light" | "medium" | "heavy";
export type GlassLayer = "base" | "elevated" | "floating";

export interface GlassConfig {
  intensity: GlassIntensity;
}

export interface GlassPreset {
  base: string;
  elevated: string;
  floating: string;
  opacityMultiplier: string;
}

export const LIGHT_GLASS_PRESETS: Record<GlassIntensity, GlassPreset> = {
  light: { base: "2px", elevated: "4px", floating: "8px", opacityMultiplier: "1.35" },
  medium: { base: "4px", elevated: "8px", floating: "12px", opacityMultiplier: "1.2" },
  heavy: { base: "8px", elevated: "16px", floating: "24px", opacityMultiplier: "1.0" },
};

// Dark surfaces need more blur separation to retain the same perceived depth.
// Keep these profiles explicit so tuning the light theme cannot silently alter
// the dark theme's established material strength.
export const DARK_GLASS_PRESETS: Record<GlassIntensity, GlassPreset> = {
  light: { base: "8px", elevated: "16px", floating: "24px", opacityMultiplier: "1.0" },
  medium: { base: "16px", elevated: "24px", floating: "40px", opacityMultiplier: "0.6" },
  heavy: { base: "24px", elevated: "36px", floating: "56px", opacityMultiplier: "0.42" },
};

export function getGlassPreset(intensity: GlassIntensity, isDark: boolean): GlassPreset {
  const presets = isDark ? DARK_GLASS_PRESETS : LIGHT_GLASS_PRESETS;
  return presets[intensity] ?? presets.medium;
}
