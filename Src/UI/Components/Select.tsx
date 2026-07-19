import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "../../Shared/Utils/cn";
import { glassVariants } from "../Core/GlassManager/variants";
import { Tooltip } from "../Feedback/Tooltip";
import { Icons } from "../Icons/IconManager";

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
        data-aurona-component-focus="true"
        className={cn(
          glassVariants({ layer: "elevated" }),
          "flex h-8 min-w-[120px] cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-1.5 text-[13px] text-[var(--TextHighlight)] outline-none transition-[background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-[var(--TextMuted)]/40",
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
          className={cn(
            glassVariants({ layer: "floating" }),
            "relative z-[9999] max-h-[300px] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl p-1 animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
          )}
          position="popper"
          side="bottom"
          align="end"
          sideOffset={4}
        >
          <SelectPrimitive.ScrollUpButton className="flex items-center justify-center h-[25px] bg-transparent text-[var(--TextPrimary)] cursor-default">
            <Icons.ChevronUp size={14} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="flex flex-col gap-1 p-1">
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                className={cn(
                  "relative flex min-h-8 w-full cursor-pointer select-none items-center rounded-lg border border-transparent py-1.5 pl-8 pr-2 text-[13px] text-[var(--TextPrimary)] outline-none transition-[background-color,border-color,color,box-shadow] data-[highlighted]:border-[var(--border-subtle)] data-[highlighted]:bg-[var(--material-interactive-hover)] data-[highlighted]:text-[var(--TextHighlight)] data-[state=checked]:border-[var(--GlassBorder)] data-[state=checked]:bg-[var(--material-surface)] data-[state=checked]:text-[var(--TextHighlight)] data-[state=checked]:shadow-sm data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                )}
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Icons.Check size={14} className="text-[var(--TextHighlight)]" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <Tooltip content={opt.label} placement="right" delay={500}>
                  <span className="min-w-0 flex-1 truncate">
                    <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                  </span>
                </Tooltip>
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
