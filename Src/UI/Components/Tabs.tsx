import type * as React from "react";
import { cn } from "../../Shared/Utils/cn";

export interface TabItem {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export function Tabs({
  items,
  value,
  onChange,
  children,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex gap-1 border-b border-[var(--border-subtle)]" role="tablist">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={value === item.value}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "border-b-2 px-3 py-2 text-[12px] text-[var(--color-text-muted)] transition-colors",
              value === item.value
                ? "border-[var(--color-accent)] text-[var(--color-text-highlight)]"
                : "border-transparent hover:text-[var(--color-text-primary)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
