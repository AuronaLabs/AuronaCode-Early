import React, { useEffect, useState } from "react";
import { type NotificationItem, NotificationService } from "../../Core/NotificationService";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { Card } from "../../UI/Components/Card";
import { EmptyState } from "../../UI/Components/EmptyState";
import { FilterChips } from "../../UI/Components/FilterChips";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";

export const NotificationsPanel = React.memo(function NotificationsPanel() {
  const { t } = useLocale();
  const [notifications, setNotifications] = useState<NotificationItem[]>(
    NotificationService.getHistory(),
  );
  const [filterType, setFilterType] = useState<"all" | "info" | "warning" | "error" | "success">(
    "all",
  );

  useEffect(() => {
    NotificationService.markAllAsRead();

    const unsub = EventBus.on("notifications:updated", (history) => {
      setNotifications([...history]);
    });
    return () => unsub();
  }, []);

  const handleClear = () => {
    NotificationService.clearAll();
  };

  const filteredNotifications = notifications.filter((item) => {
    if (filterType === "all") return true;
    if (filterType === "info") return item.type === "info" || item.type === "confirm";
    return item.type === filterType;
  });

  return (
    <div className="flex flex-col h-full w-full bg-transparent select-none">
      <SidebarPageHeader
        title={t("notifications.title")}
        actions={
          notifications.length > 0 ? (
            <Tooltip content={t("notifications.clearAll")} delay={300}>
              <button
                type="button"
                onClick={handleClear}
                className="p-1.5 hover:bg-[var(--material-interactive-hover)] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] transition-colors cursor-pointer"
              >
                <Icons.Checks size={14} />
              </button>
            </Tooltip>
          ) : undefined
        }
      />

      {/* 分类筛选标签栏 */}
      {notifications.length > 0 && (
        <FilterChips
          className="px-3 pb-2.5"
          ariaLabel={t("notifications.title")}
          value={filterType}
          onChange={setFilterType}
          items={(
            [
              { id: "all", label: t("notifications.filtersAll"), icon: null },
              { id: "info", label: t("notifications.filtersInfo"), icon: <Icons.Info size={11} /> },
              {
                id: "warning",
                label: t("notifications.filtersWarning"),
                icon: <Icons.AlertTriangle size={11} />,
              },
              {
                id: "error",
                label: t("notifications.filtersError"),
                icon: <Icons.Close size={11} />,
              },
              {
                id: "success",
                label: t("notifications.filtersSuccess"),
                icon: <Icons.Checks size={11} />,
              },
            ] as const
          )
            .map((cat) => ({
              ...cat,
              count:
                cat.id === "all"
                  ? notifications.length
                  : cat.id === "info"
                    ? notifications.filter((n) => n.type === "info" || n.type === "confirm").length
                    : notifications.filter((n) => n.type === cat.id).length,
            }))
            .filter((cat) => cat.count > 0 || cat.id === "all" || filterType === cat.id)}
        />
      )}

      <div className="flex flex-col flex-1 overflow-y-auto aurona-scroll px-3 pb-4">
        {filteredNotifications.length === 0 ? (
          <EmptyState
            className="flex-1"
            icon={<Icons.Bell size={27} stroke={1.45} />}
            title={
              filterType === "all"
                ? t("notifications.emptyTitle")
                : t("notifications.filteredEmptyTitle")
            }
            description={
              filterType === "all" ? (
                <>
                  {t("notifications.emptyHintA")}
                  <br />
                  {t("notifications.emptyHintB")}
                </>
              ) : (
                t("notifications.filteredEmptyHint")
              )
            }
            badge={t("notifications.allRead")}
          />
        ) : (
          <div className="flex flex-col gap-2 mt-1">
            {filteredNotifications.map((item) => {
              const Icon =
                item.type === "success"
                  ? Icons.Checks
                  : item.type === "error"
                    ? Icons.Close
                    : item.type === "warning"
                      ? Icons.AlertTriangle
                      : item.type === "confirm"
                        ? Icons.InfoCircle
                        : Icons.Info;

              const iconColor =
                item.type === "success"
                  ? "bg-[var(--StatusSuccess)]/10 text-[var(--StatusSuccess)]"
                  : item.type === "error"
                    ? "bg-[var(--StatusError)]/10 text-[var(--StatusError)]"
                    : item.type === "warning"
                      ? "bg-[var(--StatusWarning)]/10 text-[var(--StatusWarning)]"
                      : "bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-accent)]";

              return (
                <Card
                  key={item.id}
                  layer="base"
                  className="group relative z-10 flex gap-3 p-3 transition-colors duration-150 hover:bg-[var(--material-interactive-hover)]"
                >
                  <div
                    className={`shrink-0 flex items-center justify-center h-7 w-7 rounded-full ${iconColor}`}
                  >
                    <Icon size={14} />
                  </div>
                  <div className="flex flex-col justify-center gap-1 min-w-0">
                    {item.title && (
                      <span className="text-[12px] font-semibold text-[var(--color-text-highlight)] leading-snug">
                        {item.title}
                      </span>
                    )}
                    <span className="text-[12px] text-[var(--color-text-highlight)] leading-relaxed break-words">
                      {item.message}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
