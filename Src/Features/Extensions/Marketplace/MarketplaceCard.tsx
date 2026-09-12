import { useLocale } from "../../../Foundation/I18n";
import { useInstallProgressStore } from "../../../State/useInstallProgressStore";
import { AccountAvatar } from "../../../UI/Components/AccountAvatar";
import { Button } from "../../../UI/Components/Button";
import { Card } from "../../../UI/Components/Card";
import { Icons } from "../../../UI/Icons/IconManager";
import { ExtensionIcon } from "./ExtensionIcon";
import type { MarketplaceExtensionItem } from "./MarketplaceService";

interface MarketplaceCardProps {
  item: MarketplaceExtensionItem;
  selected?: boolean;
  onOpenDetail: (item: MarketplaceExtensionItem) => void;
  onInstall: (item: MarketplaceExtensionItem) => void;
  onUninstall: (item: MarketplaceExtensionItem) => void;
}

export function MarketplaceCard({
  item,
  selected = false,
  onOpenDetail,
  onInstall,
  onUninstall,
}: MarketplaceCardProps) {
  const { t, locale } = useLocale();
  const installTask = useInstallProgressStore((state) => state.tasks[item.id]);
  const title = item.displayName?.[locale] ?? item.name;
  const description = item.displayDescription?.[locale] ?? item.description;
  const isInstalling = Boolean(
    installTask && installTask.stage !== "completed" && installTask.stage !== "failed",
  );
  const hasMarketStats =
    item.downloads !== undefined ||
    (item.rating !== undefined && item.reviewCount !== undefined && item.reviewCount > 0);

  return (
    <Card
      data-marketplace-item-id={item.id}
      data-selected={selected || undefined}
      className="group relative flex flex-col justify-between gap-2.5 p-3 transition-colors duration-150 hover:bg-[var(--material-interactive-hover)]"
    >
      <button
        type="button"
        onClick={() => onOpenDetail(item)}
        aria-current={selected ? "true" : undefined}
        className="flex w-full cursor-pointer flex-col gap-2 text-left outline-none"
      >
        <div className="flex w-full items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-base)] text-[var(--color-text-highlight)]">
            <ExtensionIcon icon={item.icon} name={title} size={20} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-semibold text-[var(--color-text-highlight)]">
              {title}
            </span>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
              <AccountAvatar
                name={item.publisher}
                picture={item.publisherAvatar ?? null}
                size={13}
              />
              <span className="truncate">
                {item.publisher} · v{item.version}
              </span>
            </div>
          </div>
        </div>
        <p className="line-clamp-2 w-full text-left text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
          {description}
        </p>
      </button>

      <div className="mt-auto flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
        <div className="flex items-center gap-2 text-[10.5px] text-[var(--color-text-muted)]">
          {hasMarketStats ? (
            <>
              {item.downloads !== undefined && (
                <span className="flex items-center gap-1">
                  <Icons.Download size={11} />
                  {formatDownloads(item.downloads, t("extensions.noDownloads"))}
                </span>
              )}
              {item.reviewCount !== undefined &&
                item.reviewCount > 0 &&
                item.rating !== undefined && (
                  <span className="flex items-center gap-1">
                    <Icons.Sparkles size={11} className="text-amber-400" />
                    {item.rating.toFixed(1)}
                  </span>
                )}
            </>
          ) : (
            <span>{t("extensions.local")}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isInstalling ? (
            <CircularProgress
              percentage={installTask?.progress || 0}
              message={installTask?.message || t("extensions.installing")}
            />
          ) : item.updateAvailable ? (
            <Button
              size="sm"
              variant="primary"
              onClick={(event) => {
                event.stopPropagation();
                onInstall(item);
              }}
            >
              {t("extensions.update")}
            </Button>
          ) : item.installed ? (
            <>
              <span className="text-[10.5px] font-medium text-[var(--color-text-muted)]">
                {t("extensions.installed")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="text-[var(--StatusError)] hover:text-[var(--StatusError)]"
                onClick={(event) => {
                  event.stopPropagation();
                  onUninstall(item);
                }}
              >
                {t("extensions.uninstall")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={(event) => {
                event.stopPropagation();
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

function formatDownloads(value: number, emptyLabel: string): string {
  if (value <= 0) return emptyLabel;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}w`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function CircularProgress({ percentage, message }: { percentage: number; message: string }) {
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5">
      <div className="relative flex size-5.5 items-center justify-center">
        <svg className="size-5.5 -rotate-90" viewBox="0 0 24 24" role="img" aria-label={message}>
          <title>{message}</title>
          <circle
            cx="12"
            cy="12"
            r={radius}
            className="stroke-[var(--border-subtle)]"
            strokeWidth="3"
            fill="transparent"
          />
          <circle
            cx="12"
            cy="12"
            r={radius}
            className="stroke-[var(--color-accent)] transition-all duration-150"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            fill="transparent"
          />
        </svg>
      </div>
      <span className="min-w-6 text-right font-mono text-[10px] font-medium text-[var(--color-accent)]">
        {Math.round(percentage)}%
      </span>
    </div>
  );
}
