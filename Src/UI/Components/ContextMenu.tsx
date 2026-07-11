import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "../../Shared/Utils/cn";

export const ContextMenuRoot = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export const ContextMenuSubTrigger = ContextMenuPrimitive.SubTrigger;
export const ContextMenuSubContent = ContextMenuPrimitive.SubContent;

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "frosted-glass rounded-xl p-1 z-[9999] flex flex-col min-w-[160px]",
        "animate-in fade-in zoom-in-95 duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

export interface ContextMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> {
  icon?: React.ReactNode;
  label?: React.ReactNode;
  variant?: "default" | "danger";
}

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  ContextMenuItemProps
>(({ className, icon, label, variant = "default", disabled, children, ...props }, ref) => {
  const isDanger = variant === "danger";

  return (
    <ContextMenuPrimitive.Item
      ref={ref}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors text-left w-full outline-none cursor-pointer select-none",
        disabled && "opacity-50 cursor-not-allowed text-[var(--TextMuted)]",
        !disabled && isDanger && "text-red-500 focus:bg-red-500/10",
        !disabled &&
          !isDanger &&
          "text-[var(--TextHighlight)] focus:bg-black/8 dark:focus:bg-white/15",
        className,
      )}
      {...props}
    >
      {icon}
      {label || children}
    </ContextMenuPrimitive.Item>
  );
});
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

export const ContextMenuDivider = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("h-px bg-[var(--GlassBorder)] my-0.5 mx-1", className)}
    {...props}
  />
));
ContextMenuDivider.displayName = ContextMenuPrimitive.Separator.displayName;
