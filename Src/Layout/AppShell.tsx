import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { NotificationService } from "../Core/NotificationService";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { EventBus } from "../Foundation/EventBus";
import {
  SIDEBAR_DEBUG,
  SIDEBAR_EXPLORER,
  SIDEBAR_FLIUNO,
  SIDEBAR_NOTIFICATIONS,
  SIDEBAR_OUTLINE,
  SIDEBAR_SOURCE_CONTROL,
} from "../Shared/Constants/Sidebar";
import { useWorkbenchStore } from "../State/useWorkspaceStore";
import { ActivitySquare } from "../UI/Components/ActivitySquare";
import { ToastContainer } from "../UI/Feedback/Toast";
import { UpdateModal } from "../UI/Feedback/UpdateModal";
import { Fliuno } from "../UI/Fliuno/Fliuno";
import { Icons } from "../UI/Icons/IconManager";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar/TitleBar";

type AppShellProps = {
  Children: ReactNode;
};

export function AppShell({ Children }: AppShellProps) {
  const activeSidebar = useWorkbenchStore((state) => state.activeSidebar);
  const setActiveSidebar = useWorkbenchStore((state) => state.setActiveSidebar);
  const [gitChangeCount, setGitChangeCount] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(
    NotificationService.getUnreadCount(),
  );

  useEffect(() => {
    const unsubGit = EventBus.on("git:changes-count", (count: number) => {
      setGitChangeCount(count);
    });
    const unsubNotif = EventBus.on("notifications:updated", () => {
      setUnreadNotifications(NotificationService.getUnreadCount());
    });
    return () => {
      unsubGit();
      unsubNotif();
    };
  }, []);

  const activityItems: Array<{
    label: string;
    Icon: typeof Icons.Files;
    badge: boolean;
    commandId?: string;
  }> = [
    { label: SIDEBAR_EXPLORER, Icon: Icons.Files, badge: false },
    {
      label: SIDEBAR_FLIUNO,
      Icon: Icons.Search,
      badge: false,
      commandId: "workbench.action.openFliunoWorkspace",
    },
    { label: SIDEBAR_SOURCE_CONTROL, Icon: Icons.Git, badge: gitChangeCount > 0 },
    { label: SIDEBAR_OUTLINE, Icon: Icons.List, badge: false },
    { label: SIDEBAR_DEBUG, Icon: Icons.Debug, badge: false },
  ];

  const toggleActivity = (label: string) => {
    const nextSidebar = activeSidebar === label ? null : label;
    setActiveSidebar(nextSidebar);
  };

  return (
    <div
      className="flex h-dvh w-screen flex-col text-[var(--color-text-primary)] overflow-hidden"
      style={{ background: "var(--AppBackground, var(--AppBg))" }}
    >
      <div className="liquid-texture" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="relative z-[1]">
        <TitleBar />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <nav className="flex w-[var(--ActivityBarWidth)] shrink-0 flex-col items-center bg-transparent pt-0 pb-1 relative z-20">
          <div className="flex flex-1 flex-col gap-1.5 w-full items-center">
            {activityItems.map((item) => (
              <ActivitySquare
                key={item.label}
                active={activeSidebar === item.label}
                onClick={() => {
                  if (item.commandId) {
                    void CommandRegistry.execute(item.commandId);
                  } else {
                    toggleActivity(item.label);
                  }
                }}
                title={item.label}
                icon={<item.Icon size={22} stroke={1.5} />}
                badge={item.badge}
              />
            ))}
          </div>

          <div className="flex flex-col gap-1.5 mt-auto w-full items-center">
            <ActivitySquare
              active={activeSidebar === SIDEBAR_NOTIFICATIONS}
              onClick={() => toggleActivity(SIDEBAR_NOTIFICATIONS)}
              title={SIDEBAR_NOTIFICATIONS}
              icon={<Icons.Bell size={22} stroke={1.5} />}
              badge={unreadNotifications > 0}
            />
            <ActivitySquare
              onClick={() => {
                void CommandRegistry.execute("workbench.action.openSettings").then((result) => {
                  if (!result.ok && result.error) {
                    EventBus.emit("app:toast", {
                      type: "warning",
                      message: result.error.message,
                    });
                  }
                });
              }}
              title="设置"
              icon={<Icons.Settings size={22} stroke={1.5} />}
            />
          </div>
        </nav>

        <main className="flex flex-1 min-w-0 overflow-hidden bg-transparent relative z-[1]">
          <div className="absolute inset-0 h-full w-full">{Children}</div>
        </main>
      </div>

      <div className="relative z-[1]">
        <StatusBar />
      </div>

      <ToastContainer />
      <UpdateModal />
      <Fliuno />
    </div>
  );
}
