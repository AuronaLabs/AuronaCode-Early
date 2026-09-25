import type { ReactNode } from "react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AiChatService } from "../Core/AiChatService";
import { NotificationService } from "../Core/NotificationService";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { FliunoModal as Fliuno } from "../Features/Fliuno/FliunoModal";
import { EventBus } from "../Foundation/EventBus";
import { useLocale } from "../Foundation/I18n";
import {
  extensionSidebarId,
  SIDEBAR_AI,
  SIDEBAR_NOTIFICATIONS,
  SIDEBAR_SOURCE_CONTROL,
} from "../Shared/Constants/Sidebar";
import { useExtensionStore } from "../State/useExtensionStore";
import { useWorkbenchStore } from "../State/useWorkspaceStore";
import { ActivitySquare } from "../UI/Components/ActivitySquare";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "../UI/Components/ContextMenu";
import { ToastContainer } from "../UI/Feedback/Toast";
import { UpdateModal } from "../UI/Feedback/UpdateModal";
import { Icons } from "../UI/Icons/IconManager";
import { sidebarCardsByGroup } from "./SidebarCardRegistry";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar/TitleBar";

type AppShellProps = {
  Children: ReactNode;
};

function ExtensionActivityIcon({ extensionId }: { extensionId: string }) {
  const icon = useExtensionStore((state) => state.views[extensionId]?.icon);
  if (icon) {
    return (
      <span
        className="flex size-[22px] items-center justify-center [&>svg]:size-full [&>svg]:stroke-current"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: extension icon SVG is verified at package build time
        dangerouslySetInnerHTML={{ __html: icon }}
      />
    );
  }
  if (extensionId === "aurona.vscode-compat") {
    return <Icons.FileCode size={22} stroke={1.5} />;
  }
  if (extensionId.startsWith("vscode-") || extensionId.includes("vscode")) {
    return <Icons.Sparkles size={22} stroke={1.5} />;
  }
  return <Icons.Extensions size={22} stroke={1.5} />;
}

export function AppShell({ Children }: AppShellProps) {
  const { t, locale } = useLocale();
  const activeSidebar = useWorkbenchStore((state) => state.activeSidebar);
  const setActiveSidebar = useWorkbenchStore((state) => state.setActiveSidebar);
  const extensionDescriptors = useExtensionStore((state) => state.descriptors);
  const hiddenExtensionIds = useExtensionStore((state) => state.hiddenExtensionIds);
  const hideExtension = useExtensionStore((state) => state.hideExtension);
  const [gitChangeCount, setGitChangeCount] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(
    NotificationService.getUnreadCount(),
  );
  // AI 卡片可见性跟随 ai.enabled 设置（默认开启）
  const aiCardEnabled = useSyncExternalStore(
    AiChatService.subscribe,
    AiChatService.getSnapshot,
  ).cardEnabled;

  const visibleDescriptors = useMemo(
    () => extensionDescriptors.filter((d) => !hiddenExtensionIds.includes(d.id)),
    [extensionDescriptors, hiddenExtensionIds],
  );

  useEffect(() => {
    void AiChatService.refreshConfig();
    void useExtensionStore.getState().initialize();
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

  // 内置卡片活动项：从 SidebarCardRegistry 声明源驱动（行为与视觉零变化）
  const badgeForCard = (id: string) => {
    if (id === SIDEBAR_SOURCE_CONTROL) return gitChangeCount > 0;
    if (id === SIDEBAR_NOTIFICATIONS) return unreadNotifications > 0;
    return false;
  };

  const activityItems: Array<{
    id: string;
    title: string;
    icon: ReactNode;
    badge: boolean;
    commandId?: string;
  }> = sidebarCardsByGroup("main")
    .filter((card) => card.id !== SIDEBAR_AI || aiCardEnabled)
    .map((card) => {
      const Icon = Icons[card.iconKey];
      return {
        id: card.id,
        title: t(card.titleKey),
        icon: <Icon size={22} stroke={1.5} />,
        badge: badgeForCard(card.id),
        commandId: card.activityCommandId,
      };
    });

  const auxActivityItems = sidebarCardsByGroup("aux").map((card) => {
    const Icon = Icons[card.iconKey];
    return {
      id: card.id,
      title: t(card.titleKey),
      icon: <Icon size={22} stroke={1.5} />,
      badge: badgeForCard(card.id),
      commandId: card.activityCommandId,
    };
  });

  const toggleActivity = (id: string) => {
    const nextSidebar = activeSidebar === id ? null : id;
    setActiveSidebar(nextSidebar);
  };

  return (
    <div
      className="flex h-dvh w-screen flex-col text-[var(--color-text-primary)] overflow-hidden"
      style={{ background: "var(--AppBackground, var(--AppBg))" }}
    >
      <div className="liquid-texture" aria-hidden="true" />

      <div className="relative z-[1]">
        <TitleBar />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <nav className="flex w-[var(--ActivityBarWidth)] shrink-0 flex-col items-center bg-transparent pt-0 pb-1 relative z-20">
          <div className="flex flex-1 flex-col gap-1.5 w-full items-center">
            {activityItems.map((item) => (
              <ActivitySquare
                key={item.id}
                active={activeSidebar === item.id}
                onClick={() => {
                  if (item.commandId) {
                    void CommandRegistry.execute(item.commandId);
                  } else {
                    toggleActivity(item.id);
                  }
                }}
                title={item.title}
                icon={item.icon}
                badge={item.badge}
              />
            ))}
            {visibleDescriptors.length > 0 ? (
              <div className="my-1 h-px w-8 bg-[var(--border-subtle)]" aria-hidden="true" />
            ) : null}
            {visibleDescriptors.map((descriptor) => {
              const extTitle =
                descriptor.displayName?.[locale] ?? descriptor.sidebarTitle ?? descriptor.name;
              const sidebarId = extensionSidebarId(descriptor.id);
              return (
                <ContextMenuRoot key={sidebarId}>
                  <ContextMenuTrigger asChild>
                    <div>
                      <ActivitySquare
                        active={activeSidebar === sidebarId}
                        onClick={() => toggleActivity(sidebarId)}
                        title={extTitle}
                        icon={<ExtensionActivityIcon extensionId={descriptor.id} />}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      label={t("sidebar.hideExtension")}
                      icon={<Icons.Close size={14} />}
                      onSelect={() => {
                        hideExtension(descriptor.id);
                        if (activeSidebar === sidebarId) {
                          setActiveSidebar(null);
                        }
                      }}
                    />
                  </ContextMenuContent>
                </ContextMenuRoot>
              );
            })}
          </div>

          <div className="flex flex-col gap-1.5 mt-auto w-full items-center">
            {auxActivityItems.map((item) => (
              <ActivitySquare
                key={item.id}
                active={activeSidebar === item.id}
                onClick={() => {
                  if (item.commandId) {
                    void CommandRegistry.execute(item.commandId);
                  } else {
                    toggleActivity(item.id);
                  }
                }}
                title={item.title}
                icon={item.icon}
                badge={item.badge}
              />
            ))}
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
              title={t("sidebar.settings")}
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
