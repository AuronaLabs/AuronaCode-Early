import { type RefObject, useEffect, useState } from "react";
import { MarketplaceCard } from "./MarketplaceCard";
import type { MarketplaceExtensionItem } from "./MarketplaceService";

const ROW_HEIGHT = 176;

export function marketplaceWindow(count: number, top: number, height: number) {
  const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - 3);
  const end = Math.min(count, Math.ceil((top + height) / ROW_HEIGHT) + 3);
  return {
    start: Math.min(start, count),
    end,
    offset: start * ROW_HEIGHT,
    total: count * ROW_HEIGHT,
  };
}

export function MarketplaceVirtualList({
  items,
  scrollRoot,
  scrollTop,
  busyIds,
  cancellableIds,
  selectedId,
  onCancel,
  onOpenDetail,
  onInstall,
  onUninstall,
}: {
  items: MarketplaceExtensionItem[];
  scrollRoot: RefObject<HTMLDivElement | null>;
  scrollTop: number;
  busyIds: Set<string>;
  cancellableIds: Set<string>;
  selectedId: string | null;
  onCancel: (id: string) => void;
  onOpenDetail: (item: MarketplaceExtensionItem) => void;
  onInstall: (item: MarketplaceExtensionItem) => void;
  onUninstall: (item: MarketplaceExtensionItem) => void;
}) {
  const [height, setHeight] = useState(600);
  useEffect(() => {
    const node = scrollRoot.current;
    if (!node) return;
    const update = () => setHeight(node.clientHeight || 600);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRoot]);
  useEffect(() => {
    const index = items.findIndex((item) => item.id === selectedId);
    const node = scrollRoot.current;
    if (!node || index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < node.scrollTop || top + ROW_HEIGHT > node.scrollTop + node.clientHeight)
      node.scrollTop = Math.max(0, top - node.clientHeight / 2);
  }, [items, selectedId, scrollRoot]);
  const window = marketplaceWindow(items.length, scrollTop, height);
  return (
    <div className="relative w-full shrink-0" style={{ height: window.total }}>
      <div className="absolute inset-x-0" style={{ top: window.offset }}>
        {items.slice(window.start, window.end).map((item) => (
          <div key={item.id} style={{ height: ROW_HEIGHT }} className="pb-2.5">
            <MarketplaceCard
              item={item}
              fixedHeight
              busy={busyIds.has(item.id)}
              onCancel={cancellableIds.has(item.id) ? onCancel : undefined}
              selected={selectedId === item.id}
              onOpenDetail={onOpenDetail}
              onInstall={onInstall}
              onUninstall={onUninstall}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
