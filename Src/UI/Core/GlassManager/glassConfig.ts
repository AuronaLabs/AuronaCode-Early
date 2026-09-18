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
  /** --GlassShadow-Depth：投影深度（阴影扩散强度，0~1） */
  shadowDepth: string;
  /** --GlassSaturation：backdrop-saturate 通透度（1 为原色，越高越通透鲜艳） */
  saturation: string;
  /** --GlassRim-Strength：rim 高光基准强度（0~1，液态层动态幅度随此系数缩放） */
  rimStrength: string;
  /** --GlassBorder-Luminance：边框亮度（0~1，作为边框色 alpha/mix 基准） */
  borderLuminance: string;
}

export const LIGHT_GLASS_PRESETS: Record<GlassIntensity, GlassPreset> = {
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
};

// Dark surfaces need more blur separation to retain the same perceived depth.
// Keep these profiles explicit so tuning the light theme cannot silently alter
// the dark theme's established material strength.
export const DARK_GLASS_PRESETS: Record<GlassIntensity, GlassPreset> = {
  light: {
    base: "8px",
    raised: "16px",
    overlay: "18px",
    opacityMultiplier: "1.0",
    shadowDepth: "0.1",
    saturation: "1.12",
    rimStrength: "0.7",
    borderLuminance: "0.7",
  },
  medium: {
    base: "16px",
    raised: "24px",
    overlay: "32px",
    opacityMultiplier: "0.6",
    shadowDepth: "0.15",
    saturation: "1.2",
    rimStrength: "0.85",
    borderLuminance: "0.8",
  },
  heavy: {
    base: "24px",
    raised: "36px",
    overlay: "44px",
    opacityMultiplier: "0.55",
    shadowDepth: "0.2",
    saturation: "1.3",
    rimStrength: "1",
    borderLuminance: "0.9",
  },
};

export function getGlassPreset(intensity: GlassIntensity, isDark: boolean): GlassPreset {
  const presets = isDark ? DARK_GLASS_PRESETS : LIGHT_GLASS_PRESETS;
  return presets[intensity] ?? presets.medium;
}
