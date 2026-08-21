import { useLocale } from "../../../Foundation/I18n";
import { cn } from "../../../Shared/Utils/cn";
import { Button } from "../../../UI/Components/Button";
import { Card } from "../../../UI/Components/Card";
import { Icons } from "../../../UI/Icons/IconManager";
import { ExtensionIcon } from "./ExtensionIcon";
import type { MarketplaceExtensionItem } from "./MarketplaceService";

interface MarketplaceCardProps {
  item: MarketplaceExtensionItem;
  onOpenDetail: (item: MarketplaceExtensionItem) => void;
  onOpenSettings?: (extensionId: string) => void;
  onOpenSidebar?: (extensionId: string) => void;
}

export function MarketplaceCard({ item, onOpenDetail }: MarketplaceCardProps) {
  const { t, locale } = useLocale();

  const title = item.displayName?.[locale] ?? item.name;
  const description = item.displayDescription?.[locale] ?? item.description;

  return (
    <Card
      className={cn(
        "group relative flex flex-col justify-between p-3 rounded-xl hover:bg-[var(--color-surface-3)] transition-all duration-200 gap-2.5",
      )}
    >
      {/* 顶部与主体可点击区域 */}
      <button
        type="button"
        onClick={() => onOpenDetail(item)}
        className="flex flex-col text-left w-full gap-2 outline-none cursor-pointer"
      >
        <div className="flex items-start gap-3 w-full">
          {/* 图标 */}
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] border border-[var(--border-subtle)] group-hover:scale-105 transition-transform overflow-hidden">
            <ExtensionIcon icon={item.icon} name={title} size={20} />
          </div>

          {/* 主信息 */}
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold text-[var(--color-text-highlight)] group-hover:text-blue-400 transition-colors">
                {title}
              </span>
              {item.verified && (
                <span
                  role="img"
                  aria-label={t("extensions.officialVerified")}
                  className="text-blue-400 flex items-center shrink-0"
                >
                  <Icons.Check size={13} stroke={2.5} />
                </span>
              )}
            </div>

            <span className="truncate text-[11px] text-[var(--color-text-muted)] mt-0.5">
              {item.publisher} · v{item.version}
            </span>
          </div>
        </div>

        {/* 描述 */}
        <p className="text-[11.5px] text-[var(--color-text-secondary)] line-clamp-2 leading-relaxed">
          {description}
        </p>
      </button>

      {/* 底部元数据与操作 */}
      <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 mt-auto">
        <div className="flex items-center gap-2 text-[10.5px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <Icons.Download size={11} />
            {item.downloads >= 1000 ? `${(item.downloads / 1000).toFixed(1)}k` : item.downloads}
          </span>
          <span className="flex items-center gap-1">
            <Icons.Sparkles size={11} className="text-amber-400" />
            {item.rating.toFixed(1)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="primary"
            className="h-6 px-3 text-[10.5px] rounded-lg shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail(item);
            }}
          >
            {t("extensions.install")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
