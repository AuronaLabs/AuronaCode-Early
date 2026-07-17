import * as React from "react";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../Core/GlassManager/variants";

export const glassListHeaderStyles =
  "flex min-h-10 items-center border-b border-[var(--GlassBorder)] bg-[var(--GlassSurface-Base)] px-3.5 py-2.5 text-[12px] text-[var(--TextHighlight)] backdrop-blur-[var(--glass-blur-base)]";

export const glassListRowStyles =
  "group relative flex items-center rounded-xl border border-transparent px-3 py-2 text-[12px] text-[var(--TextPrimary)] transition-[background-color,border-color,color,box-shadow] duration-150 hover:border-[var(--GlassBorder)] hover:bg-[var(--GlassHover)] hover:text-[var(--TextHighlight)] focus-visible:outline-none focus-visible:border-[var(--TextMuted)]/30 focus-visible:ring-2 focus-visible:ring-[var(--TextMuted)]/20";

export const GlassList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        glassVariants({ layer: "base" }),
        "overflow-hidden rounded-2xl shadow-[var(--shadow-surface)]",
        className,
      )}
      {...props}
    />
  ),
);
GlassList.displayName = "GlassList";
