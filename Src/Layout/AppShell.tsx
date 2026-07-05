import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { NotificationService } from "../Core/NotificationService";
import { SearchPanel } from "../Features/Search/SearchPanel";
import { EventBus } from "../Foundation/EventBus";
import {
  SIDEBAR_EXPLORER,
  SIDEBAR_NOTIFICATIONS,
  SIDEBAR_SEARCH,
  SIDEBAR_SOURCE_CONTROL,
  SIDEBAR_PLUGINS,
} from "../Shared/Constants/Sidebar";
import { ActivitySquare } from "../UI/Components/ActivitySquare";
import { ToastContainer } from "../UI/Feedback/Toast";
import { Icons } from "../UI/Icons/IconManager";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar/TitleBar";

type AppShellProps = {
  Children: ReactNode;
};

export function AppShell({ Children }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<string | null>(SIDEBAR_EXPLORER);
  const [hasGitBadge, setHasGitBadge] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(
    NotificationService.getUnreadCount(),
  );

  useEffect(() => {
    const unsubGit = EventBus.on("git:changes-count", (count: number) => {
      setHasGitBadge(count > 0);
    });
    const unsubNotif = EventBus.on("notifications:updated", () => {
      setUnreadNotifications(NotificationService.getUnreadCount());
    });
    return () => {
      unsubGit();
      unsubNotif();
    };
  }, []);

  const activityItems = [
    { label: SIDEBAR_EXPLORER, Icon: Icons.Files, badge: false },
    { label: SIDEBAR_SEARCH, Icon: Icons.Search, badge: false },
    { label: SIDEBAR_SOURCE_CONTROL, Icon: Icons.Git, badge: hasGitBadge },
    { label: SIDEBAR_PLUGINS, Icon: Icons.Extensions, badge: false },
  ];

  const toggleActivity = (label: string) => {
    const nextTab = activeTab === label ? null : label;
    setActiveTab(nextTab);
    EventBus.emit("app:activity-changed", nextTab);
  };

  return (
    <div
      className="flex h-dvh w-screen flex-col text-[var(--TextPrimary)] overflow-hidden"
      style={{ background: "var(--AppBackground, var(--AppBg))" }}
    >
      <TitleBar />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <nav className="flex w-[var(--ActivityBarWidth)] shrink-0 flex-col items-center bg-transparent pt-0 pb-1 relative z-20">
          <div className="flex flex-1 flex-col gap-1.5 w-full items-center">
            {activityItems.map((item) => (
              <ActivitySquare
                key={item.label}
                active={activeTab === item.label}
                onClick={() => toggleActivity(item.label)}
                title={item.label}
                icon={<item.Icon size={22} stroke={1.5} />}
                badge={item.badge}
              />
            ))}
          </div>

          <div className="flex flex-col gap-1.5 mt-auto w-full items-center">
            <ActivitySquare
              active={activeTab === SIDEBAR_NOTIFICATIONS}
              onClick={() => toggleActivity(SIDEBAR_NOTIFICATIONS)}
              title={SIDEBAR_NOTIFICATIONS}
              icon={<Icons.Bell size={22} stroke={1.5} />}
              badge={unreadNotifications > 0}
            />
            <ActivitySquare
              onClick={() => {
                EventBus.emit("app:open-tab", { id: "settings", type: "settings", title: "设置" });
              }}
              title="设置"
              icon={<Icons.Settings size={22} stroke={1.5} />}
            />
          </div>
        </nav>

        <main className="flex flex-1 min-w-0 overflow-hidden bg-transparent relative">
          <div className="absolute inset-0 h-full w-full">{Children}</div>
        </main>
      </div>

      <StatusBar />

      <ToastContainer />
    </div>
  );
}
