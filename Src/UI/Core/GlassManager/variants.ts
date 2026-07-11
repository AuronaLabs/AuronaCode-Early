import { cva } from "class-variance-authority";

export const glassVariants = cva(
  "border border-[var(--GlassBorder)] transition-all duration-300",
  {
    variants: {
      layer: {
        base: "bg-[var(--GlassSurface-Base)] backdrop-blur-[var(--glass-blur-base)]",
        elevated: "bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] shadow-sm dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]",
        floating: "bg-[var(--GlassSurface-Floating)] backdrop-blur-[var(--glass-blur-floating)] shadow-xl dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]",
      },
      interactive: {
        true: "hover:bg-[var(--GlassHover)] active:scale-[0.98]",
        false: "",
      }
    },
    defaultVariants: {
      layer: "base",
      interactive: false,
    }
  }
);
