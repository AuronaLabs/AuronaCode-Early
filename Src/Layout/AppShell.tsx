import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { TitleBar } from "./TitleBar/TitleBar";
import { ActivitySquare } from "../UI/Components/ActivitySquare";
import { Icons } from "../UI/Icons/IconManager";
import { EventBus } from "../Core/EventBus";
import { ToastContainer } from "../UI/Feedback/Toast";
import { EditorAdapter } from "../Features/Editor/EditorAdapter";
import { EMPTY_EDITOR_STATUS, EditorStatus } from "../Features/Editor/IEditorEngine";
import { SearchPanel } from "../Features/Search/SearchPanel";
import { NotificationService } from "../Core/NotificationService";
import {
  SIDEBAR_EXPLORER,
  SIDEBAR_NOTIFICATIONS,
  SIDEBAR_SEARCH,
  SIDEBAR_SOURCE_CONTROL,
} from "../Shared/Constants/Sidebar";

type AppShellProps = {
  Children: ReactNode;
};

const formatLanguage = (language: string) => {
  const labels: Record<string, string> = {
    plaintext: "Plain Text",
    typescript: "TypeScript",
    javascript: "JavaScript",
    json: "JSON",
    css: "CSS",
    scss: "SCSS",
    html: "HTML",
    markdown: "Markdown",
    rust: "Rust",
    python: "Python",
    java: "Java",
    cpp: "C++",
    go: "Go",
    shell: "Shell",
    powershell: "PowerShell",
    yaml: "YAML",
    toml: "TOML",
    sql: "SQL",
    xml: "XML",
  };
  return labels[language] ?? language;
};

export function AppShell({ Children }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<string | null>(SIDEBAR_EXPLORER);
  const [editorStatus, setEditorStatus] = useState<EditorStatus>(EMPTY_EDITOR_STATUS);
  const [hasGitBadge, setHasGitBadge] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(NotificationService.getUnreadCount());

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

  useEffect(() => {
    return EditorAdapter.onStatusChange(setEditorStatus);
  }, []);

  const activityItems = [
    { label: SIDEBAR_EXPLORER, Icon: Icons.Files, badge: false },
    { label: SIDEBAR_SEARCH, Icon: Icons.Search, badge: false },
    { label: SIDEBAR_SOURCE_CONTROL, Icon: Icons.Git, badge: hasGitBadge },
  ];

  const toggleActivity = (label: string) => {
    const nextTab = activeTab === label ? null : label;
    setActiveTab(nextTab);
    EventBus.emit("app:activity-changed", nextTab);
  };

  return (
    <div className="flex h-dvh w-screen flex-col text-[var(--ColorText)] overflow-hidden" style={{ background: "var(--AppBackground, var(--ColorApp))" }}>
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

      <footer className="flex h-[var(--StatusBarHeight)] shrink-0 items-center bg-transparent px-4 text-xs text-[var(--ColorMuted)] font-medium overflow-hidden">
        <div className="flex items-center gap-4 min-w-0">
          <span className="cursor-default truncate">
            {editorStatus.errors} 错误, {editorStatus.warnings} 警告
          </span>
          {editorStatus.hasEditor && (
            <span className="cursor-default truncate">
              行 {editorStatus.line}, 列 {editorStatus.column}
              {editorStatus.selectionLength > 0 ? ` (${editorStatus.selectionLength} 已选)` : ""}
            </span>
          )}
        </div>
        <div className="ml-auto hidden sm:flex items-center gap-4 min-w-0">
          {editorStatus.hasEditor && (
            <>
              <span className="cursor-default">{editorStatus.encoding}</span>
              <span className="cursor-default">{editorStatus.lineEnding}</span>
              <span className="cursor-default">
                {editorStatus.insertSpaces ? "空格" : "Tab"}: {editorStatus.tabSize}
              </span>
              <span className="cursor-default truncate">{formatLanguage(editorStatus.language)}</span>
            </>
          )}
        </div>
      </footer>

      <ToastContainer />
    </div>
  );
}
