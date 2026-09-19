import { create } from "zustand";
import { persist } from "zustand/middleware";
import { legacyGlassIntensityToNumber, resolveContinuousPreset } from "./glassConfig";

interface GlassStore {
  /** 玻璃强度连续值 0-100（0 轻透 / 50 均衡 / 100 醇厚锚点，中间值线性插值） */
  intensity: number;
  setIntensity: (val: number) => void;
  applyToDOM: () => void;
}

export const useGlassStore = create<GlassStore>()(
  persist(
    (set, get) => ({
      intensity: 50,
      setIntensity: (val) => {
        set({ intensity: Math.min(Math.max(val, 0), 100) });
        get().applyToDOM();
      },
      applyToDOM: () => {
        const { intensity } = get();
        const root = document.documentElement;

        // 连续强度经 resolveContinuousPreset 插值出全轴材质，明暗方案各自独立标定
        const preset = resolveContinuousPreset(
          intensity,
          root.classList.contains("dark") ? "dark" : "light",
        );

        root.style.setProperty("--glass-blur-base", preset.base);
        root.style.setProperty("--glass-blur-raised", preset.raised);
        root.style.setProperty("--glass-blur-overlay", preset.overlay);
        root.style.setProperty("--GlassOpacity-Multiplier", preset.opacityMultiplier);
        // 多轴材质（--Glass* 静态令牌，强度全权；--Liquid* 动态层另行按流光动效开关门控）
        root.style.setProperty("--GlassShadow-Depth", preset.shadowDepth);
        root.style.setProperty("--GlassSaturation", preset.saturation);
        root.style.setProperty("--GlassRim-Strength", preset.rimStrength);
        root.style.setProperty("--GlassBorder-Luminance", preset.borderLuminance);
      },
    }),
    {
      name: "aurona-glass-settings",
      version: 1,
      // v0 持久化的是三档字符串档位；迁移为 0-100 连续强度（轻透 0 / 均衡 50 / 醇厚 100）
      migrate: (persistedState, version) => {
        const legacy = persistedState as { intensity?: unknown } | null;
        if (version < 1 && typeof legacy?.intensity === "string") {
          return {
            ...legacy,
            intensity: legacyGlassIntensityToNumber(legacy.intensity),
          } as GlassStore;
        }
        return persistedState as GlassStore;
      },
    },
  ),
);
