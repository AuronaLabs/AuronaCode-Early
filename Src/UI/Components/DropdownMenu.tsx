import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../../Shared/Utils/cn";

export const DropdownMenuRoot = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "frosted-glass rounded-xl p-1 z-[9999] flex flex-col min-w-[160px]",
        "animate-in fade-in zoom-in-95 duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

export interface DropdownMenuItemProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  icon?: React.ReactNode;
  label?: React.ReactNode;
  rightElement?: React.ReactNode;
  variant?: "default" | "danger";
}

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className, icon, label, rightElement, variant = "default", disabled, children, ...props }, ref) => {
  const isDanger = variant === "danger";

  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      disabled={disabled}
      className={cn(
        "flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors text-left w-full outline-none cursor-pointer select-none",
        disabled && "opacity-50 cursor-not-allowed text-[var(--TextMuted)]",
        !disabled && isDanger && "text-red-500 focus:bg-red-500/10",
        !disabled && !isDanger && "text-[var(--TextHighlight)] focus:bg-black/8 dark:focus:bg-white/15",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        {icon}
        {label || children}
      </div>
      {rightElement && <div className="text-[var(--TextMuted)] text-[11px]">{rightElement}</div>}
    </DropdownMenuPrimitive.Item>
  );
});
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

export const DropdownMenuDivider = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("h-px bg-[var(--GlassBorder)] my-0.5 mx-1", className)}
    {...props}
  />
));
DropdownMenuDivider.displayName = DropdownMenuPrimitive.Separator.displayName;
