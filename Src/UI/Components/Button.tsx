import React from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  children: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", fullWidth = false, className = "", children, ...props }, ref) => {
    
    let variantStyles = "";
    switch (variant) {
      case "primary":
        variantStyles = "bg-[var(--AccentPrimary)] text-white hover:bg-[var(--AccentHover)] border border-white/20 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-[var(--AccentPrimary)]/50";
        break;
      case "secondary":
        variantStyles = "bg-[var(--GlassHover)] text-[var(--TextHighlight)] hover:bg-[var(--GlassBorder)] border border-[var(--GlassBorder)] focus-visible:ring-2 focus-visible:ring-[var(--GlassBorder)]";
        break;
      case "danger":
        variantStyles = "bg-red-500/90 text-white hover:bg-red-500 border border-red-400/20 focus-visible:ring-2 focus-visible:ring-red-500/50";
        break;
      case "ghost":
        variantStyles = "bg-transparent text-[var(--TextPrimary)] hover:bg-[var(--GlassHover)] hover:text-[var(--TextHighlight)] focus-visible:ring-2 focus-visible:ring-[var(--GlassBorder)]";
        break;
    }

    const widthStyles = fullWidth ? "w-full" : "w-auto";

    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-1.5 text-[12px] font-medium transition-all duration-200 ease-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] ${variantStyles} ${widthStyles} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
