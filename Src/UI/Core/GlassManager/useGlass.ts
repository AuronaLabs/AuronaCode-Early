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
        root.style.setProperty("--glass-blur-elevated", preset.elevated);
        root.style.setProperty("--glass-blur-floating", preset.floating);
        root.style.setProperty("--GlassOpacity-Multiplier", preset.opacityMultiplier);
      },
    }),
    { name: "aurona-glass-settings" },
  ),
);
