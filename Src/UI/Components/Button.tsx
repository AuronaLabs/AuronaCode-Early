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
        variantStyles = "bg-[var(--ColorAccent)] text-white hover:bg-[var(--ColorAccentHover)] shadow-sm";
        break;
      case "secondary":
        variantStyles = "bg-[var(--ColorRailHover)] text-[var(--ColorTextHighlight)] hover:bg-[var(--ColorPanelBorder)] border border-[var(--ColorPanelBorder)]";
        break;
      case "danger":
        variantStyles = "bg-red-600 text-white hover:bg-red-700 shadow-sm";
        break;
      case "ghost":
        variantStyles = "bg-transparent text-[var(--ColorText)] hover:bg-white/5 hover:text-[var(--ColorTextHighlight)]";
        break;
    }

    const widthStyles = fullWidth ? "w-full" : "w-auto";

    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-1.5 text-[12px] font-medium transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles} ${widthStyles} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
