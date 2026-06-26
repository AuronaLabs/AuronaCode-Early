import React from "react";
import { IconSearch } from "@tabler/icons-react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ icon, fullWidth = false, className = "", ...props }, ref) => {
    
    const widthStyles = fullWidth ? "w-full" : "w-auto";

    return (
      <div className={`relative flex items-center ${widthStyles}`}>
        {icon && (
          <div className="absolute left-2.5 flex items-center justify-center text-[var(--ColorMuted)] pointer-events-none">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={`flex h-7 w-full rounded-md border border-[var(--ColorPanelBorder)] bg-[var(--ColorEditor)] backdrop-blur-xl text-[12px] text-[var(--ColorTextHighlight)] transition-all duration-200 placeholder:text-[var(--ColorMuted)] focus:outline-none ${
            icon ? "pl-8 pr-3" : "px-3"
          } ${className}`}
          {...props}
        />
      </div>
    );
  }
);
Input.displayName = "Input";
