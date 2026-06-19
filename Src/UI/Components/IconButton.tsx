import React from "react";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  active?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, active = false, className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors focus:outline-none ${
          active
            ? "bg-[var(--ColorRailActive)] text-[var(--ColorApp)]"
            : "text-[var(--ColorText)] hover:bg-white/10 hover:text-[var(--ColorTextHighlight)]"
        } ${className}`}
        {...props}
      >
        {icon}
      </button>
    );
  }
);
IconButton.displayName = "IconButton";
