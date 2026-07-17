import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../Core/GlassManager/variants";

const inputVariants = cva(
  "flex w-full rounded-lg text-[12px] text-[var(--TextHighlight)] outline-none transition-[background-color,border-color,color,box-shadow,opacity] duration-150 placeholder:text-[var(--TextMuted)] disabled:cursor-not-allowed disabled:opacity-50",
  {
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
  surface?: "glass" | "embedded";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputSize, icon, fullWidth = false, surface = "glass", ...props }, ref) => {
    return (
      <div className={cn("relative flex items-center", fullWidth ? "w-full" : "w-auto", className)}>
        {icon && (
          <div className="absolute left-2.5 flex items-center justify-center text-[var(--TextMuted)] pointer-events-none">
            {icon}
          </div>
        )}
        <input
          data-aurona-input={surface}
          className={cn(
            surface === "glass"
              ? cn(
                  glassVariants({ layer: "elevated" }),
                  "focus-visible:border-[var(--TextMuted)]/25 focus-visible:ring-2 focus-visible:ring-[var(--TextMuted)]/25",
                )
              : "border border-transparent bg-transparent shadow-none backdrop-blur-none focus-visible:border-transparent focus-visible:ring-0",
            inputVariants({ inputSize, hasIcon: !!icon }),
          )}
          ref={ref}
          {...props}
        />
      </div>
    );
  },
);

Input.displayName = "Input";
