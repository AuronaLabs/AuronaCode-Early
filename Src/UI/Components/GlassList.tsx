import * as React from "react";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../Core/GlassManager/variants";

export const glassListHeaderStyles =
  "flex min-h-10 items-center border-b border-[var(--border-subtle)] bg-[var(--surface-base)] px-3.5 py-2.5 text-[12px] text-[var(--color-text-highlight)] backdrop-blur-[var(--surface-blur-base)] backdrop-saturate-[var(--GlassSaturation)] glass-layer-base";

export const glassListRowStyles =
  "group relative flex items-center rounded-control border border-transparent px-3 py-2 text-[12px] text-[var(--color-text-primary)] transition-[background-color,border-color,color,box-shadow] duration-150 hover:border-[var(--border-subtle)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] focus-visible:outline-none focus-visible:border-[var(--color-text-muted)]/30 focus-visible:ring-2 focus-visible:ring-[var(--color-text-muted)]/20";

export const GlassList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(glassVariants({ layer: "base" }), "overflow-hidden rounded-surface", className)}
      {...props}
    />
  ),
);
GlassList.displayName = "GlassList";
