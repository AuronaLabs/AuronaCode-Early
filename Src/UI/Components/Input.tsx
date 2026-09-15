import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../Core/GlassManager/variants";

/**
 * 统一焦点语言（与 Marketplace 搜索框一致）：淡灰高亮边框 + 14% 光晕，
 * 由 wrapper 的 focus-within 驱动；内层 input 通过 data-aurona-input
 * 关闭浏览器/主题焦点描边（Theme.css）。
 */
const FOCUS_WITHIN =
  "focus-within:border-[var(--color-text-muted)]/25 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-text-muted)_14%,transparent)]";

/** 三档尺寸共享同一焦点语言；圆角随尺寸递进（lg 即 Marketplace 大圆角）。 */
const inputVariants = cva("transition-[border-color,box-shadow]", {
  variants: {
    inputSize: {
      sm: "h-7 rounded-lg",
      md: "h-9 rounded-xl",
      lg: "h-10 rounded-2xl",
    },
  },
  defaultVariants: {
    inputSize: "md",
  },
});

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
      <div
        className={cn(
          "relative flex items-center border",
          fullWidth ? "w-full" : "w-auto",
          surface === "glass"
            ? glassVariants({ layer: "raised" })
            : "border-transparent bg-transparent shadow-none backdrop-blur-none",
          inputVariants({ inputSize }),
          FOCUS_WITHIN,
          className,
        )}
      >
        {icon && (
          <div className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[var(--color-text-muted)]">
            {icon}
          </div>
        )}
        <input
          data-aurona-input={surface}
          className={cn(
            "h-full w-full min-w-0 bg-transparent text-[var(--color-text-highlight)] outline-none placeholder:text-[var(--color-text-muted)] disabled:cursor-not-allowed disabled:opacity-50",
            inputSize === "sm" ? "text-[12px]" : "text-[12.5px]",
            icon ? "pl-9 pr-3.5" : inputSize === "sm" ? "px-3" : "px-3.5",
          )}
          ref={ref}
          {...props}
        />
      </div>
    );
  },
);

Input.displayName = "Input";
