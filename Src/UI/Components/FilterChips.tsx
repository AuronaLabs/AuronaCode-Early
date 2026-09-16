import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../Foundation/I18n";
import { cn } from "../../Shared/Utils/cn";
import { Icons } from "../Icons/IconManager";

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
 *
 * 溢出策略（用户约定：全程无滚动条）：横向溢出时显示 EditorTabBar 同款左右
 * 箭头按钮（4px 回滞检测 + smooth 步进），选中 chip 变化时自动滚入视野。
 */
export function FilterChips<T extends string>({
  items,
  value,
  onChange,
  size = "sm",
  ariaLabel,
  className,
}: FilterChipsProps<T>) {
  const { t } = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 保留 4px 回滞，避免在边缘来回移动时箭头反复出现/消失。
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    void items.length;
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [items.length, updateScrollState]);

  // 选中 chip 变化时自动滚入视野（对齐 EditorTabBar 的激活标签跟随）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !value) return;
    el.querySelector<HTMLElement>(`[data-chip-id="${value}"]`)?.scrollIntoView({
      behavior: "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [value]);

  const scrollChips = useCallback((direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.max(160, el.clientWidth * 0.6);
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  }, []);

  const arrowButtonClass =
    "grid size-5 place-items-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-muted)]";

  return (
    <div className={cn("flex min-w-0 items-center", className)}>
      <div
        ref={scrollRef}
        role="tablist"
        aria-label={ariaLabel}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar"
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-chip-id={item.id}
              onClick={() => onChange(item.id)}
              className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition-colors duration-150",
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
      <div className="flex shrink-0 items-center gap-0.5 pl-1">
        <button
          type="button"
          aria-label={t("common.scrollLeft")}
          onClick={() => scrollChips(-1)}
          disabled={!canScrollLeft}
          className={arrowButtonClass}
        >
          <Icons.ChevronLeft size={13} stroke={2} />
        </button>
        <button
          type="button"
          aria-label={t("common.scrollRight")}
          onClick={() => scrollChips(1)}
          disabled={!canScrollRight}
          className={arrowButtonClass}
        >
          <Icons.ChevronRight size={13} stroke={2} />
        </button>
      </div>
    </div>
  );
}
