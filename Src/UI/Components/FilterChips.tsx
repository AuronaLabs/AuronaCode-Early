import type { ReactNode } from "react";
import { cn } from "../../Shared/Utils/cn";

export interface FilterChipItem<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  count?: number;
}

interface FilterChipsProps<T extends string> {
  items: FilterChipItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** sm: 侧边栏紧凑 chips；md: 28px 高的工具行页签 */
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}

/**
 * 侧边栏工具行统一的筛选/页签胶囊组。
 * 选中态：interactive-active 背景 + subtle 边框；未选中：透明边框 + muted 文本。
 */
export function FilterChips<T extends string>({
  items,
  value,
  onChange,
  size = "sm",
  ariaLabel,
  className,
}: FilterChipsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex shrink-0 items-center gap-1 overflow-x-auto no-scrollbar", className)}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border font-medium transition-colors duration-150",
              size === "sm" ? "px-2.5 py-1 text-[11px]" : "h-[28px] px-3 text-[12px]",
              selected
                ? "border-[var(--border-subtle)] bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]",
            )}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.count !== undefined && item.count > 0 && (
              <span className="opacity-60 text-[10px]">({item.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
