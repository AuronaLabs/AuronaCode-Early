import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../Core/GlassManager/variants";

export const ContextMenu = ContextMenuPrimitive.Root;
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
        glassVariants({ layer: "floating" }),
        "p-1.5 z-[9999] flex flex-col min-w-[160px] rounded-xl overflow-hidden shadow-2xl",
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
  rightElement?: React.ReactNode;
  variant?: "default" | "danger";
}

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  ContextMenuItemProps
>(
  (
    { className, icon, label, rightElement, variant = "default", disabled, children, ...props },
    ref,
  ) => {
    const isDanger = variant === "danger";

    return (
      <ContextMenuPrimitive.Item
        ref={ref}
        disabled={disabled}
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors text-left w-full outline-none cursor-pointer select-none",
          disabled && "opacity-50 cursor-not-allowed text-[var(--TextMuted)]",
          !disabled && isDanger && "text-red-500 focus:bg-red-500/10",
          !disabled &&
            !isDanger &&
            "text-[var(--TextHighlight)] focus:bg-[var(--GlassHover)]",
          className,
        )}
        {...props}
      >
        <div className="flex items-center gap-2">
          {icon}
          {label || children}
        </div>
        {rightElement && <div className="text-[var(--TextMuted)] text-[11px]">{rightElement}</div>}
      </ContextMenuPrimitive.Item>
    );
  },
);
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

export const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("h-px bg-[var(--GlassBorder)] my-0.5 mx-1", className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

export const ContextMenuDivider = ContextMenuSeparator;
