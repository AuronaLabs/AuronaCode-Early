import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";
import { cn } from "../../Shared/Utils/cn";

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {}

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      className={cn(
        "group peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-0 p-0.5 backdrop-blur-[var(--glass-blur-elevated)] transition-[background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text-muted)]/35 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--switch-track-on)] data-[state=checked]:shadow-[var(--switch-checked-glow)] data-[state=unchecked]:bg-[var(--switch-track-off)] data-[state=unchecked]:shadow-[var(--switch-track-shadow)]",
        className,
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-[18px] w-[18px] rounded-full border-0 bg-[var(--switch-thumb-surface)] shadow-[var(--switch-thumb-shadow)] backdrop-blur-[var(--glass-blur-floating)] transition-[transform,background-color,box-shadow] duration-200 data-[state=checked]:translate-x-5 data-[state=checked]:shadow-[var(--switch-thumb-shadow-checked)] data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = SwitchPrimitive.Root.displayName;
