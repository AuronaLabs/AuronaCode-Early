import * as MenubarPrimitive from "@radix-ui/react-menubar";
import * as React from "react";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../Core/GlassManager/variants";

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
      "flex h-[26px] cursor-pointer items-center rounded-control px-2.5 outline-none select-none text-[var(--color-text-primary)] text-[13px]",
      "hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] transition-colors",
      "data-[state=open]:bg-[var(--material-interactive-active)] data-[state=open]:text-[var(--color-text-highlight)]",
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
        glassVariants({ layer: "overlay" }),
        "rounded-overlay p-1 z-[9999] flex flex-col min-w-[160px] overflow-hidden",
        "animate-in fade-in duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out",
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
          "flex items-center justify-between gap-2 px-3 py-1.5 rounded-control text-[13px] transition-colors text-left w-full outline-none cursor-pointer select-none",
          disabled && "opacity-50 cursor-not-allowed text-[var(--color-text-muted)]",
          !disabled && isDanger && "text-[var(--StatusError)] focus:bg-[var(--StatusError)]/10",
          !disabled &&
            !isDanger &&
            "text-[var(--color-text-highlight)] focus:bg-[var(--material-interactive-hover)]",
          className,
        )}
        {...props}
      >
        <div className="flex items-center gap-2">
          {icon}
          {label || children}
        </div>
        {rightElement && (
          <div className="text-[var(--color-text-muted)] text-[11px] ml-auto">{rightElement}</div>
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
    className={cn("h-px bg-[var(--border-subtle)] my-0.5 mx-1", className)}
    {...props}
  />
));
MenubarDivider.displayName = MenubarPrimitive.Separator.displayName;
