import * as React from "react";
import { cn } from "../../Shared/Utils/cn";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, ...props }, ref) => (
    <label className={cn("inline-flex items-center gap-2 text-[13px]", className)}>
      <input
        {...props}
        ref={ref}
        type="checkbox"
        className="size-4 accent-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
      />
      {label}
    </label>
  ),
);
Checkbox.displayName = "Checkbox";
