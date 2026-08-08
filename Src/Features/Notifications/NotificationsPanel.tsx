import React, { useEffect, useState } from "react";
import { type NotificationItem, NotificationService } from "../../Core/NotificationService";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";

export const NotificationsPanel = React.memo(function NotificationsPanel() {
  const { t } = useLocale();
  const [notifications, setNotifications] = useState<NotificationItem[]>(
    NotificationService.getHistory(),
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

  return (
    <div className="flex flex-col h-full w-full bg-transparent">
      {}
      <SidebarPageHeader
        title={t("notifications.title")}
        actions={
          notifications.length > 0 ? (
            <Tooltip content={t("notifications.clearAll")} delay={300}>
              <button
                type="button"
                onClick={handleClear}
                className="p-1.5 hover:bg-[var(--material-interactive-hover)] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] transition-colors"
              >
                <Icons.Checks size={14} />
              </button>
            </Tooltip>
          ) : undefined
        }
      />

      {}
      <div className="flex flex-col flex-1 overflow-y-auto aurona-scroll px-3 pb-4">
        {notifications.length === 0 ? (
          <div className="relative flex flex-1 flex-col items-center justify-center gap-5 overflow-hidden px-5 text-center">
            <div className="pointer-events-none absolute h-44 w-44 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] blur-3xl" />
            <div className="relative">
              <div className="absolute inset-0 scale-125 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] blur-xl" />
              <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--color-accent)_22%,var(--border-subtle))] bg-[var(--material-surface)] text-[var(--color-accent)]">
                <Icons.Bell size={27} stroke={1.45} />
              </div>
            </div>
            <div className="relative z-10 space-y-2">
              <h3 className="text-[14px] font-semibold text-[var(--color-text-highlight)]">
                {t("notifications.emptyTitle")}
              </h3>
              <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                {t("notifications.emptyHintA")}
                <br />
                {t("notifications.emptyHintB")}
              </p>
            </div>
            <div className="relative z-10 flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_16%,var(--border-subtle))] bg-[var(--material-panel)] px-3 py-1 text-[11px] font-medium text-[var(--color-text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              {t("notifications.allRead")}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-2">
            {notifications.map((item) => {
              const Icon =
                item.type === "success"
                  ? Icons.Checks
                  : item.type === "error"
                    ? Icons.Close
                    : item.type === "warning"
                      ? Icons.AlertTriangle
                      : Icons.Info;

              const bgColor =
                item.type === "success"
                  ? "bg-green-500/10 text-green-500"
                  : item.type === "error"
                    ? "bg-red-500/10 text-red-500"
                    : item.type === "warning"
                      ? "bg-yellow-500/10 text-yellow-500"
                      : "bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-accent)]";

              return (
                <div
                  key={item.id}
                  className="flex gap-3 bg-[var(--material-surface)] backdrop-blur-[var(--glass-blur-elevated)] border border-[var(--border-subtle)] rounded-2xl p-3 z-10 hover:border-[var(--border-overlay)] transition-all group relative"
                >
                  <div
                    className={`shrink-0 flex items-center justify-center h-7 w-7 rounded-full ${bgColor}`}
                  >
                    <Icon size={14} />
                  </div>
                  <div className="flex flex-col justify-center gap-1 min-w-0">
                    <span className="text-[12px] text-[var(--color-text-highlight)] leading-relaxed break-words">
                      {item.message}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
