import React from "react";
import { Tooltip } from "../Feedback/Tooltip";

interface ActivitySquareProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  active?: boolean;
  badge?: boolean;
}

export const ActivitySquare = React.forwardRef<HTMLButtonElement, ActivitySquareProps>(
  ({ icon, active = false, badge = false, className = "", title, ...props }, ref) => {
    const buttonElement = (
      <button
        type="button"
        ref={ref}
        className={`relative flex h-[calc(var(--ActivityBarWidth)-16px)] w-[calc(var(--ActivityBarWidth)-16px)] min-h-8 min-w-8 items-center justify-center rounded-xl transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--AccentPrimary)]/60 ${
          active
            ? "bg-[var(--GlassActive)] backdrop-blur-[var(--glass-blur-elevated)] text-[var(--TextHighlight)] shadow-sm ring-1 ring-inset ring-[var(--GlassBorder)]"
            : "text-[var(--TextMuted)] hover:bg-[var(--GlassHover)] hover:backdrop-blur-[var(--glass-blur-base)] hover:text-[var(--TextHighlight)]"
        } ${className}`}
        {...props}
      >
        <div className="flex items-center justify-center relative">
          {icon}
          {badge && (
            <span className="absolute -top-0.5 -right-0.5 w-[7px] h-[7px] rounded-full bg-[var(--AccentPrimary)] shadow-sm"></span>
          )}
        </div>
      </button>
    );

    if (title) {
      return (
        <Tooltip content={title} delay={200} placement="right">
          {buttonElement}
        </Tooltip>
      );
    }

    return buttonElement;
  },
);
ActivitySquare.displayName = "ActivitySquare";
