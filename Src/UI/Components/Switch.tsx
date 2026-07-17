import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";
import { cn } from "../../Shared/Utils/cn";

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {}

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      className={cn(
        "group peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border p-0.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_8px_rgba(15,23,42,0.08)] backdrop-blur-[var(--glass-blur-elevated)] transition-[background-color,border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--TextMuted)]/35 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[var(--switch-on-border)] data-[state=checked]:bg-[var(--switch-on-surface)] data-[state=checked]:shadow-[inset_0_1px_1px_rgba(255,255,255,0.22),0_0_0_1px_color-mix(in_srgb,var(--AccentPrimary)_12%,transparent),0_4px_14px_rgba(15,23,42,0.1)] data-[state=unchecked]:border-[var(--GlassBorder)] data-[state=unchecked]:bg-[var(--GlassSurface-Base)]",
        className,
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none relative block h-[18px] w-[18px] rounded-full border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Floating)] shadow-[0_2px_8px_rgba(15,23,42,0.22),inset_0_1px_1px_rgba(255,255,255,0.35)] backdrop-blur-[var(--glass-blur-floating)] transition-[transform,background-color,box-shadow] duration-200 data-[state=checked]:translate-x-5 data-[state=checked]:border-[var(--switch-on-border)] data-[state=checked]:shadow-[0_2px_10px_rgba(59,130,246,0.3),inset_0_1px_1px_rgba(255,255,255,0.45)] data-[state=unchecked]:translate-x-0",
        )}
      >
        <span className="absolute inset-[5px] rounded-full bg-[var(--TextMuted)] opacity-35 transition-[background-color,box-shadow,opacity,transform] duration-200 group-data-[state=checked]:scale-110 group-data-[state=checked]:bg-[var(--switch-on-indicator)] group-data-[state=checked]:opacity-100 group-data-[state=checked]:shadow-[0_0_7px_var(--switch-on-indicator)]" />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = SwitchPrimitive.Root.displayName;
