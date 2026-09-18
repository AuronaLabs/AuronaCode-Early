import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type GlassIntensity, getGlassPreset } from "./glassConfig";

interface GlassStore {
  intensity: GlassIntensity;
  setIntensity: (val: GlassIntensity) => void;
  applyToDOM: () => void;
}

export const useGlassStore = create<GlassStore>()(
  persist(
    (set, get) => ({
      intensity: "medium",
      setIntensity: (val) => {
        set({ intensity: val });
        get().applyToDOM();
      },
      applyToDOM: () => {
        const { intensity } = get();
        const root = document.documentElement;

        const preset = getGlassPreset(intensity, root.classList.contains("dark"));

        root.style.setProperty("--glass-blur-base", preset.base);
        root.style.setProperty("--glass-blur-raised", preset.raised);
        root.style.setProperty("--glass-blur-overlay", preset.overlay);
        root.style.setProperty("--GlassOpacity-Multiplier", preset.opacityMultiplier);
        // 多轴材质（--Glass* 静态令牌，档位全权；--Liquid* 动态层另行按流光动效开关门控）
        root.style.setProperty("--GlassShadow-Depth", preset.shadowDepth);
        root.style.setProperty("--GlassSaturation", preset.saturation);
        root.style.setProperty("--GlassRim-Strength", preset.rimStrength);
        root.style.setProperty("--GlassBorder-Luminance", preset.borderLuminance);
      },
    }),
    { name: "aurona-glass-settings" },
  ),
);
