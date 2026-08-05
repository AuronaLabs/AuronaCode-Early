import { cva } from "class-variance-authority";

export const glassVariants = cva(
  "border border-[var(--border-subtle)] transition-[background-color,border-color,box-shadow,transform] duration-300",
  {
    variants: {
      layer: {
        base: "bg-[var(--material-panel)] backdrop-blur-[var(--glass-blur-base)]",
        elevated: "bg-[var(--material-surface)] backdrop-blur-[var(--glass-blur-elevated)]",
        floating: "bg-[var(--material-overlay)] backdrop-blur-[var(--glass-blur-floating)]",
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
