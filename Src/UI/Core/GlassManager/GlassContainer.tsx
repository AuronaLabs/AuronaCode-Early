import { type ClassValue, clsx } from "clsx";
import React from "react";
import { twMerge } from "tailwind-merge";
import { glassVariants } from "./variants";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface GlassContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  layer?: "base" | "elevated" | "floating";
  interactive?: boolean;
}

export const GlassContainer = React.forwardRef<HTMLDivElement, GlassContainerProps>(
  ({ className, layer, interactive, ...props }, ref) => {
    return (
      <div ref={ref} className={cn(glassVariants({ layer, interactive }), className)} {...props} />
    );
  },
);
GlassContainer.displayName = "GlassContainer";
