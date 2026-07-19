import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";
import { cn } from "../../Shared/Utils/cn";

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {}

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      className={cn(
        "group peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-0 p-0.5 backdrop-blur-[var(--glass-blur-elevated)] transition-[background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--TextMuted)]/35 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--switch-track-on)] data-[state=checked]:shadow-[inset_0_1px_1px_rgba(255,255,255,0.28),0_3px_12px_color-mix(in_srgb,var(--AccentPrimary)_18%,transparent),0_0_14px_color-mix(in_srgb,var(--AccentPrimary)_24%,transparent)] data-[state=unchecked]:bg-[var(--switch-track-off)] data-[state=unchecked]:shadow-[inset_0_2px_5px_rgba(15,23,42,0.14),0_1px_3px_rgb(15_23_42_/_8%)]",
        className,
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-[18px] w-[18px] rounded-full border-0 bg-[var(--switch-thumb-surface)] shadow-[0_2px_8px_rgba(15,23,42,0.22),inset_0_1px_1px_rgba(255,255,255,0.42)] backdrop-blur-[var(--glass-blur-floating)] transition-[transform,background-color,box-shadow] duration-200 data-[state=checked]:translate-x-5 data-[state=checked]:shadow-[0_3px_10px_rgb(15_23_42_/_24%),0_0_10px_color-mix(in_srgb,var(--AccentPrimary)_34%,transparent),inset_0_1px_1px_rgba(255,255,255,0.62)] data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = SwitchPrimitive.Root.displayName;
