import React from "react";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  active?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, active = false, className = "", ...props }, ref) => {
    return (
      <button
        type="button"
        ref={ref}
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-[var(--AccentPrimary)]/60 ${
          active
            ? "bg-[var(--GlassActive)] text-[var(--AppBg)]"
            : "text-[var(--TextPrimary)] hover:bg-white/10 hover:text-[var(--TextHighlight)]"
        } ${className}`}
        {...props}
      >
        {icon}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";
