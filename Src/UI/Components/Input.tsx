import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../Core/GlassManager/variants";

const inputVariants = cva(
  "flex w-full rounded-lg text-[12px] text-[var(--TextHighlight)] transition-all duration-200 placeholder:text-[var(--TextMuted)] focus:outline-none focus:ring-1 focus:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50",  {
    variants: {
      inputSize: {
        default: "h-7 px-3",
        sm: "h-6 px-2 text-[11px]",
        lg: "h-9 px-4 text-[13px]",
      },
      hasIcon: {
        true: "pl-8",
        false: "",
      },
    },
    defaultVariants: {
      inputSize: "default",
      hasIcon: false,
    },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputSize, icon, fullWidth = false, ...props }, ref) => {
    return (
      <div className={cn("relative flex items-center", fullWidth ? "w-full" : "w-auto", className)}>
        {icon && (
          <div className="absolute left-2.5 flex items-center justify-center text-[var(--TextMuted)] pointer-events-none">
            {icon}
          </div>
        )}
        <input className={cn(glassVariants({ layer: "elevated" }), inputVariants({ inputSize, hasIcon: !!icon }))} ref={ref} {...props} />
      </div>
    );
  },
);

Input.displayName = "Input";
