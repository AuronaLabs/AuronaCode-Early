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
        className={`relative flex h-[calc(var(--ActivityBarWidth)-16px)] w-[calc(var(--ActivityBarWidth)-16px)] min-h-8 min-w-8 items-center justify-center rounded-xl transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 ${
          active
            ? "bg-[var(--material-interactive-active)] backdrop-blur-[var(--glass-blur-elevated)] text-[var(--color-text-highlight)] ring-1 ring-inset ring-[var(--border-subtle)]"
            : "text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:backdrop-blur-[var(--glass-blur-base)] hover:text-[var(--color-text-highlight)]"
        } ${className}`}
        {...props}
      >
        <div className="flex items-center justify-center relative">
          {icon}
          {badge && (
            <span
              aria-hidden="true"
              className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-[var(--color-accent)]"
            />
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
