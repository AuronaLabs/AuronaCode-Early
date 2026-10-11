import type React from "react";
import { type RefObject, useEffect, useState } from "react";

export interface VirtualListProps<T> {
  items: T[];
  itemHeight: number | ((item: T, index: number) => number);
  renderItem: (item: T, index: number) => React.ReactNode;
  getItemKey?: (item: T, index: number) => React.Key;
  overscan?: number;
  onLoadMore?: () => void;
  scrollRoot: RefObject<HTMLElement | null>;
  scrollTop: number;
}

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  getItemKey,
  overscan = 3,
  onLoadMore,
  scrollRoot,
  scrollTop,
}: VirtualListProps<T>) {
  const [height, setHeight] = useState(600);
  const fixedHeight = typeof itemHeight === "number" ? itemHeight : null;
  const variableHeight = typeof itemHeight === "function" ? itemHeight : null;
  const total = fixedHeight
    ? items.length * fixedHeight
    : items.reduce((sum, item, index) => sum + (variableHeight?.(item, index) ?? 0), 0);
  useEffect(() => {
    const node = scrollRoot.current;
    if (!node) return;
    const update = () => setHeight(node.clientHeight || 600);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRoot]);
  const start = fixedHeight ? Math.max(0, Math.floor(scrollTop / fixedHeight) - overscan) : 0;
  const end = fixedHeight
    ? Math.min(items.length, Math.ceil((scrollTop + height) / fixedHeight) + overscan)
    : items.length;
  useEffect(() => {
    if (fixedHeight && onLoadMore && end >= items.length - 1) onLoadMore();
  }, [end, fixedHeight, items.length, onLoadMore]);
  if (!fixedHeight) {
    return <>{items.map((item, index) => renderItem(item, index))}</>;
  }
  return (
    <div className="relative w-full shrink-0" style={{ height: total }}>
      <div className="absolute inset-x-0" style={{ top: start * fixedHeight }}>
        {items.slice(start, end).map((item, index) => (
          <div
            key={getItemKey?.(item, start + index) ?? String(item)}
            style={{ height: fixedHeight }}
          >
            {renderItem(item, start + index)}
          </div>
        ))}
      </div>
    </div>
  );
}
