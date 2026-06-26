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
        ref={ref}
        className={`relative flex h-[calc(var(--ActivityBarWidth)-16px)] w-[calc(var(--ActivityBarWidth)-16px)] min-h-8 min-w-8 items-center justify-center rounded-lg transition-colors duration-150 focus:outline-none ${
          active
            ? "bg-black/10 dark:bg-white/15 text-[var(--ColorTextHighlight)]"
            : "text-[var(--ColorMuted)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--ColorTextHighlight)]"
        } ${className}`}
        {...props}
      >
        <div className="flex items-center justify-center relative">
          {icon}
          {badge && <span className="absolute -top-0.5 -right-0.5 w-[7px] h-[7px] rounded-full bg-[var(--ColorAccent)] shadow-sm"></span>}
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
  }
);
ActivitySquare.displayName = "ActivitySquare";
