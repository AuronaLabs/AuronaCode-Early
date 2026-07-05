import { IconSearch } from "@tabler/icons-react";
import React from "react";

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
          <div className="absolute left-2.5 flex items-center justify-center text-[var(--TextMuted)] pointer-events-none">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={`flex h-7 w-full rounded-md border border-[var(--GlassBorder)] bg-[var(--GlassSurface)] backdrop-blur-xl text-[12px] text-[var(--TextHighlight)] transition-all duration-200 placeholder:text-[var(--TextMuted)] focus:outline-none ${
            icon ? "pl-8 pr-3" : "px-3"
          } ${className}`}
          {...props}
        />
      </div>
    );
  },
);
Input.displayName = "Input";
