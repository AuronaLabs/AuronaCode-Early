import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`bg-[var(--ColorEditor)] rounded-xl overflow-hidden border border-[var(--ColorPanelBorder)] backdrop-blur-2xl dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";
