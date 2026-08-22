import { useLocale } from "../../../Foundation/I18n";
import { cn } from "../../../Shared/Utils/cn";
import { AccountAvatar } from "../../../UI/Components/AccountAvatar";
import { Button } from "../../../UI/Components/Button";
import { Card } from "../../../UI/Components/Card";
import { Icons } from "../../../UI/Icons/IconManager";
import { ExtensionIcon } from "./ExtensionIcon";
import type { MarketplaceExtensionItem } from "./MarketplaceService";

interface MarketplaceCardProps {
  item: MarketplaceExtensionItem;
  onOpenDetail: (item: MarketplaceExtensionItem) => void;
  onInstall: (item: MarketplaceExtensionItem) => void;
  onUninstall: (item: MarketplaceExtensionItem) => void;
  onOpenSettings?: (extensionId: string) => void;
  onOpenSidebar?: (extensionId: string) => void;
}

export function MarketplaceCard({
  item,
  onOpenDetail,
  onInstall,
  onUninstall,
}: MarketplaceCardProps) {
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

            <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] mt-0.5 min-w-0">
              <AccountAvatar
                name={item.publisher}
                picture={item.publisherAvatar ?? null}
                size={13}
                className="shrink-0"
              />
              <span className="truncate">
                {item.publisher} · v{item.version}
              </span>
            </div>
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
            {item.reviewCount && item.reviewCount > 0 ? (
              <>
                <Icons.Sparkles size={11} className="text-amber-400" />
                {item.rating.toFixed(1)}
              </>
            ) : (
              <span className="text-[var(--color-text-muted)]">暂未定级</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {item.updateAvailable ? (
            <Button
              size="sm"
              variant="primary"
              className="h-6 px-3 text-[10.5px] rounded-lg shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onInstall(item);
              }}
            >
              更新
            </Button>
          ) : item.installed ? (
            <>
              <span className="group-hover:hidden text-[10.5px] px-2 py-0.5 rounded-md bg-[var(--material-interactive-active)] text-[var(--color-text-muted)] border border-[var(--border-subtle)] font-medium">
                {t("extensions.installed")}
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="hidden group-hover:inline-flex h-6 px-3 text-[10.5px] rounded-lg text-red-400 hover:text-red-300"
                onClick={(e) => {
                  e.stopPropagation();
                  onUninstall(item);
                }}
              >
                卸载
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="primary"
              className="h-6 px-3 text-[10.5px] rounded-lg shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onInstall(item);
              }}
            >
              {t("extensions.install")}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
