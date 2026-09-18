import { cva } from "class-variance-authority";

export const glassVariants = cva(
  "rounded-[var(--radius-surface)] border border-[var(--border-subtle)] transition-[background-color,border-color,box-shadow,transform] duration-300",
  {
    variants: {
      layer: {
        base: "glass-layer-base bg-[var(--surface-base)] backdrop-blur-[var(--surface-blur-base)] backdrop-saturate-[var(--GlassSaturation)]",
        raised:
          "glass-layer-raised bg-[var(--surface-raised)] backdrop-blur-[var(--surface-blur-raised)] backdrop-saturate-[var(--GlassSaturation)]",
        overlay:
          "glass-layer-overlay rounded-[var(--radius-overlay)] bg-[var(--surface-overlay)] backdrop-blur-[var(--surface-blur-overlay)] backdrop-saturate-[var(--GlassSaturation)] shadow-[var(--shadow-overlay)]",
      },
      interactive: {
        true: "hover:bg-[var(--material-interactive-hover)] active:scale-[0.98]",
        false: "",
      },
    },
    defaultVariants: {
      layer: "base",
      interactive: false,
    },
  },
);
