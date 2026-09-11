import React from "react";

import { cn } from "../../Shared/Utils/cn";
import { GlassContainer } from "../Core/GlassManager";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  layer?: "base" | "raised" | "overlay";
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className, layer = "raised", ...props }, ref) => {
    return (
      <GlassContainer
        ref={ref}
        layer={layer}
        className={cn("rounded-[var(--radius-surface)] overflow-hidden", className)}
        {...props}
      >
        {children}
      </GlassContainer>
    );
  },
);

Card.displayName = "Card";
