import React from "react";

import { GlassContainer } from "../Core/GlassManager";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className = "", ...props }, ref) => {
    return (
      <GlassContainer
        ref={ref}
        layer="base"
        className={`rounded-xl overflow-hidden ${className}`}
        {...props}
      >
        {children}
      </GlassContainer>
    );
  },
);

Card.displayName = "Card";
