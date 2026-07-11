import * as React from "react";
import * as MenubarPrimitive from "@radix-ui/react-menubar";
import { cn } from "../../Shared/Utils/cn";

export const MenubarRoot = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Root
    ref={ref}
    className={cn("flex h-full items-center space-x-0.5", className)}
    {...props}
  />
));
MenubarRoot.displayName = MenubarPrimitive.Root.displayName;

export const MenubarMenu = MenubarPrimitive.Menu;
export const MenubarPortal = MenubarPrimitive.Portal;
export const MenubarSub = MenubarPrimitive.Sub;
export const MenubarSubTrigger = MenubarPrimitive.SubTrigger;
export const MenubarSubContent = MenubarPrimitive.SubContent;
export const MenubarRadioGroup = MenubarPrimitive.RadioGroup;

export const MenubarTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-[26px] cursor-pointer items-center rounded-lg px-2.5 outline-none select-none text-[var(--TextPrimary)] text-[13px]",
      "hover:bg-[var(--GlassHover)] dark:hover:bg-white/15 hover:text-[var(--TextHighlight)] transition-colors",
      "data-[state=open]:bg-black/8 dark:data-[state=open]:bg-white/15 data-[state=open]:text-[var(--TextHighlight)]",
      className,
    )}
    {...props}
  />
));
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName;

export const MenubarContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>
>(({ className, align = "start", alignOffset = -4, sideOffset = 2, ...props }, ref) => (
  <MenubarPrimitive.Portal>
    <MenubarPrimitive.Content
      ref={ref}
      align={align}
      alignOffset={alignOffset}
      sideOffset={sideOffset}
      className={cn(
        "frosted-glass rounded-xl p-1 z-[9999] flex flex-col min-w-[160px]",
        "animate-in fade-in zoom-in-95 duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
        className,
      )}
      {...props}
    />
  </MenubarPrimitive.Portal>
));
MenubarContent.displayName = MenubarPrimitive.Content.displayName;

export interface MenubarItemProps
  extends React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item> {
  icon?: React.ReactNode;
  label?: React.ReactNode;
  rightElement?: React.ReactNode;
  variant?: "default" | "danger";
}

export const MenubarItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Item>,
  MenubarItemProps
>(
  (
    { className, icon, label, rightElement, variant = "default", disabled, children, ...props },
    ref,
  ) => {
    const isDanger = variant === "danger";

    return (
      <MenubarPrimitive.Item
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
        {rightElement && (
          <div className="text-[var(--TextMuted)] text-[11px] ml-auto">{rightElement}</div>
        )}
      </MenubarPrimitive.Item>
    );
  },
);
MenubarItem.displayName = MenubarPrimitive.Item.displayName;

export const MenubarDivider = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Separator
    ref={ref}
    className={cn("h-px bg-[var(--GlassBorder)] my-0.5 mx-1", className)}
    {...props}
  />
));
MenubarDivider.displayName = MenubarPrimitive.Separator.displayName;
