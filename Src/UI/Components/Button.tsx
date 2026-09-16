import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../Shared/Utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 text-[13px] font-medium transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text-muted)]/40 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-accent)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-hover)] border border-[color-mix(in_srgb,var(--color-accent)_24%,transparent)]",
        secondary:
          "bg-[var(--material-interactive-hover)] text-[var(--color-text-highlight)] hover:bg-[var(--border-subtle)] border border-[var(--border-subtle)]",
        danger:
          "bg-[var(--DiagError)]/90 text-white hover:bg-[var(--DiagError)] border border-[color-mix(in_srgb,var(--DiagError)_24%,transparent)]",
        ghost:
          "bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]",
        glass:
          "border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--color-text-highlight)] backdrop-blur-[var(--glass-blur-raised)] hover:bg-[var(--material-interactive-hover)]",
      },
      size: {
        default: "h-8 rounded-xl px-4 py-1.5",
        sm: "h-7 rounded-full px-3.5 text-[12px]",
        lg: "h-10 rounded-2xl px-8 text-[14px]",
        icon: "h-8 w-8 rounded-xl",
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
