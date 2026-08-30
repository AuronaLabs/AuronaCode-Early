import { useLocale } from "../../../Foundation/I18n";
import { cn } from "../../../Shared/Utils/cn";
import { useInstallProgressStore } from "../../../State/useInstallProgressStore";
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
  const installTask = useInstallProgressStore((state) => state.tasks[item.id]);

  const title = item.displayName?.[locale] ?? item.name;
  const description = item.displayDescription?.[locale] ?? item.description;
  const isInstalling = Boolean(
    installTask && installTask.stage !== "completed" && installTask.stage !== "failed",
  );

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
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="truncate text-[13px] font-semibold text-[var(--color-text-highlight)] group-hover:text-blue-400 transition-colors">
                {title}
              </span>
            </div>

            {/* 作者与版本行 */}
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

        {/* 简介 */}
        <p className="text-[11.5px] leading-relaxed text-[var(--color-text-muted)] line-clamp-2 w-full text-left">
          {description}
        </p>
      </button>

      {/* 底部元数据与操作 */}
      <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 mt-auto">
        <div className="flex items-center gap-2 text-[10.5px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <Icons.Download size={11} />
            {item.downloads >= 10000
              ? `${(item.downloads / 10000).toFixed(1)}w`
              : item.downloads >= 1000
                ? `${(item.downloads / 1000).toFixed(1)}k`
                : item.downloads > 0
                  ? item.downloads
                  : t("extensions.noDownloads")}
          </span>
          {item.reviewCount && item.reviewCount > 0 ? (
            <span className="flex items-center gap-1">
              <Icons.Sparkles size={11} className="text-amber-400" />
              {item.rating.toFixed(1)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {isInstalling ? (
            /* 圆形平滑进度环 */
            <CircularProgress
              percentage={installTask?.progress || 0}
              message={installTask?.message || "正在安装..."}
            />
          ) : item.updateAvailable ? (
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

function CircularProgress({ percentage, message }: { percentage: number; message: string }) {
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5">
      <div className="relative size-5.5 flex items-center justify-center">
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
            className="stroke-blue-400 transition-all duration-150"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            fill="transparent"
          />
        </svg>
      </div>
      <span className="text-[10px] font-mono text-blue-400 font-medium min-w-[24px] text-right">
        {Math.round(percentage)}%
      </span>
    </div>
  );
}
