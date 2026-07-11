import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../Shared/Utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-[13px] font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--AccentPrimary)]/50 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--AccentPrimary)] text-white hover:bg-[var(--AccentHover)] shadow-sm border border-black/5 dark:border-white/10",
        secondary:
          "bg-[var(--GlassHover)] text-[var(--TextHighlight)] hover:bg-[var(--GlassBorder)] border border-[var(--GlassBorder)]",
        danger:
          "bg-red-500/90 text-white hover:bg-red-500 shadow-sm border border-red-400/20 focus-visible:ring-red-500/50",
        ghost:
          "bg-transparent text-[var(--TextPrimary)] hover:bg-[var(--GlassHover)] hover:text-[var(--TextHighlight)]",
        glass: "frosted-glass text-[var(--TextHighlight)] hover:bg-white/10 dark:hover:bg-black/10",
      },
      size: {
        default: "h-8 px-4 py-1.5",
        sm: "h-7 px-3 text-[12px]",
        lg: "h-10 px-8 text-[14px]",
        icon: "h-8 w-8",
      },
      fullWidth: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
      fullWidth: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
