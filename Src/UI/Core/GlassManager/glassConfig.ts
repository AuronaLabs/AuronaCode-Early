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

/** 单轴线性插值：解析数值并保留 px 单位，按 t 混合，四位小数消除浮点尾差。
    端点直接原样返回，保证锚点值（含 "1.0" 等原格式）逐字符不变。 */
function lerpAxis(from: string, to: string, t: number): string {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const unit = from.endsWith("px") ? "px" : "";
  const a = Number.parseFloat(from);
  const b = Number.parseFloat(to);
  return `${Number((a + (b - a) * t).toFixed(4))}${unit}`;
}

/**
 * 多轴材质线性插值（t∈[0,1]，超界钳制）：对预设全部材质轴
 * （模糊三轴 + 透明度/投影/饱和度/rim/边框亮度）逐轴混合，
 * 用于三档锚点之间的连续玻璃强度。
 */
export function lerpGlassPreset(a: GlassPreset, b: GlassPreset, t: number): GlassPreset {
  const clamped = Math.min(Math.max(t, 0), 1);
  return {
    base: lerpAxis(a.base, b.base, clamped),
    raised: lerpAxis(a.raised, b.raised, clamped),
    overlay: lerpAxis(a.overlay, b.overlay, clamped),
    opacityMultiplier: lerpAxis(a.opacityMultiplier, b.opacityMultiplier, clamped),
    shadowDepth: lerpAxis(a.shadowDepth, b.shadowDepth, clamped),
    saturation: lerpAxis(a.saturation, b.saturation, clamped),
    rimStrength: lerpAxis(a.rimStrength, b.rimStrength, clamped),
    borderLuminance: lerpAxis(a.borderLuminance, b.borderLuminance, clamped),
  };
}

/**
 * 连续玻璃强度（0-100）→ 插值档位：0 / 50 / 100 分别锚定
 * 轻透 / 均衡 / 醇厚三档，中间值在相邻锚点间线性插值。
 */
export function resolveContinuousPreset(intensity: number, scheme: "light" | "dark"): GlassPreset {
  const presets = scheme === "dark" ? DARK_GLASS_PRESETS : LIGHT_GLASS_PRESETS;
  const t = Math.min(Math.max(intensity, 0), 100) / 100;
  return t <= 0.5
    ? lerpGlassPreset(presets.light, presets.medium, t * 2)
    : lerpGlassPreset(presets.medium, presets.heavy, (t - 0.5) * 2);
}

/** 旧三档字符串档位 → 连续强度（0-100）：light→0，medium/balanced→50，heavy/rich→100 */
export function legacyGlassIntensityToNumber(value: string): number {
  if (value === "light") return 0;
  if (value === "heavy" || value === "rich") return 100;
  return 50;
}

/**
 * 玻璃状态染色（iOS 26 liquid glass 语言）：极弱底染 + 边缘点缀。
 * 卡片本体保持中性玻璃观感，状态色只以 6% 底染与 12% 勾边出现；
 * 更强的点缀交给 .glass-accent-halo 光斑与图标容器染色。
 */
export function computeGlassAccent(
  bg: string,
  border: string,
): { background: string; borderColor: string } {
  return {
    background: `color-mix(in srgb, ${bg} 6%, var(--material-overlay))`,
    borderColor: `color-mix(in srgb, ${border} 12%, var(--border-subtle))`,
  };
}
