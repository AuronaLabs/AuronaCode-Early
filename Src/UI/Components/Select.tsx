import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Icons } from "../Icons/IconManager";
import { cn } from "../../Shared/Utils/cn";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Select({ options, value, onChange, className }: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger
        className={cn(
          "flex h-8 w-full min-w-[120px] items-center justify-between gap-3 bg-[var(--GlassSurface)] backdrop-blur-md border border-[var(--GlassBorder)] rounded-xl px-3 py-1.5 text-[13px] text-[var(--TextHighlight)] outline-none hover:bg-[var(--GlassHover)] transition-all cursor-pointer focus:ring-2 focus:ring-[var(--AccentPrimary)]/50 shadow-sm",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder="Select an option" />
        <SelectPrimitive.Icon asChild>
          <Icons.ChevronDown size={14} className="text-[var(--TextMuted)] opacity-70" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="relative z-[9999] max-h-[300px] min-w-[var(--radix-select-trigger-width)] overflow-hidden frosted-glass rounded-xl p-1 shadow-2xl animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
          position="popper"
          side="bottom"
          align="end"
          sideOffset={4}
        >
          <SelectPrimitive.ScrollUpButton className="flex items-center justify-center h-[25px] bg-transparent text-[var(--TextPrimary)] cursor-default">
            <Icons.ChevronUp size={14} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                className={cn(
                  "relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-2 text-[13px] text-[var(--TextPrimary)] outline-none focus:bg-[var(--AccentPrimary)] focus:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-50 transition-colors",
                )}
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Icons.Check size={14} className="text-current" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex items-center justify-center h-[25px] bg-transparent text-[var(--TextPrimary)] cursor-default">
            <Icons.ChevronDown size={14} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
