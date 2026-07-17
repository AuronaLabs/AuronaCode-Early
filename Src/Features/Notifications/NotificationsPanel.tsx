import React, { useEffect, useState } from "react";
import { type NotificationItem, NotificationService } from "../../Core/NotificationService";
import { EventBus } from "../../Foundation/EventBus";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";

export const NotificationsPanel = React.memo(function NotificationsPanel() {
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
      <div className="flex items-center justify-between px-[var(--PanelPaddingX)] pt-4 pb-2 shrink-0">
        <h2 className="text-[14px] font-bold text-[var(--TextHighlight)] tracking-tight">通知</h2>
        {notifications.length > 0 && (
          <Tooltip content="清除所有通知" delay={300}>
            <button
              type="button"
              onClick={handleClear}
              className="p-1.5 hover:bg-[var(--GlassHover)] rounded-lg text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] transition-colors"
            >
              <Icons.Checks size={14} />
            </button>
          </Tooltip>
        )}
      </div>

      {}
      <div className="flex flex-col flex-1 overflow-y-auto aurona-scroll px-3 pb-4">
        {notifications.length === 0 ? (
          <div className="flex flex-col flex-1 items-center justify-center text-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--GlassSurface-Elevated)] text-[var(--TextMuted)]">
              <Icons.Bell size={32} stroke={1} />
            </div>
            <div className="space-y-1">
              <h3 className="text-[13px] font-semibold text-[var(--TextHighlight)]">暂无新通知</h3>
              <p className="text-[11px] text-[var(--TextMuted)] leading-relaxed">
                我们会在后台静默处理大部分任务
                <br />
                仅在必要时通知你
              </p>
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
                      : "bg-blue-500/10 text-blue-500";

              return (
                <div
                  key={item.id}
                  className="flex gap-3 bg-white/5 bg-[var(--GlassSurface-Elevated)] backdrop-blur-[var(--glass-blur-elevated)] border border-black/5 dark:border-white/5 rounded-2xl p-3 z-10 hover:border-black/20 dark:hover:border-white/20 transition-all group relative"
                >
                  <div
                    className={`shrink-0 flex items-center justify-center h-7 w-7 rounded-full ${bgColor}`}
                  >
                    <Icon size={14} />
                  </div>
                  <div className="flex flex-col justify-center gap-1 min-w-0">
                    <span className="text-[12px] text-[var(--TextHighlight)] leading-relaxed break-words">
                      {item.message}
                    </span>
                    <span className="text-[10px] text-[var(--TextMuted)]">
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
