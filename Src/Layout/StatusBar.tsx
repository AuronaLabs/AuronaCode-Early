import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AccountService } from "../Core/AccountService";
import { type LanguageServerInfo, LspClient } from "../Core/Language/LspClient";
import { type StatusBarItemHandle, StatusBarRegistry } from "../Core/StatusBar/StatusBarRegistry";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { EventBus } from "../Foundation/EventBus";
import { LocaleService, useLocale } from "../Foundation/I18n";
import { LanguageServerIPC } from "../Foundation/IPC/LanguageServerCommands";
import { GetLanguageFromPath } from "../Shared/Utils/LanguageUtils";
import { useEditorStore } from "../State/useEditorStore";
import { useWorkbenchStore } from "../State/useWorkspaceStore";
import { AccountAvatar } from "../UI/Components/AccountAvatar";
import { Tooltip } from "../UI/Feedback/Tooltip";

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

function DynamicStatusBarItem({ item }: { item: StatusBarItemHandle }) {
  const handleClick = useCallback(() => {
    if (item.onClick) {
      void item.onClick();
    } else if (item.command) {
      void CommandRegistry.execute(item.command);
    }
  }, [item]);

  const content = (
    <button
      type="button"
      onClick={handleClick}
      className={`flex items-center gap-1.5 rounded-control px-1.5 py-0.5 transition-colors cursor-pointer hover:bg-[var(--material-interactive-hover)] ${item.className || ""}`}
    >
      <span>{item.text}</span>
    </button>
  );

  if (item.tooltip) {
    return (
      <Tooltip content={item.tooltip} placement="top" delay={200}>
        {content}
      </Tooltip>
    );
  }

  return content;
}

export function StatusBar() {
  const { t } = useLocale();
  useSyncExternalStore(
    StatusBarRegistry.subscribe,
    StatusBarRegistry.getSnapshot,
    StatusBarRegistry.getSnapshot,
  );
  const account = useSyncExternalStore(
    AccountService.subscribe,
    () => AccountService.getSnapshot(),
    () => AccountService.getSnapshot(),
  );
  const editorStatus = useEditorStore((state) => state.editorStatus);
  const setActiveBottomPanel = useWorkbenchStore((state) => state.setActiveBottomPanel);
  const activeFilePath = useWorkbenchStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab?.type === "file" ? tab.path : undefined;
  });
  const activeLanguage = GetLanguageFromPath(activeFilePath ?? null);
  const [languageServer, setLanguageServer] = useState<LanguageServerInfo | undefined>(() =>
    LspClient.getInstance().getState(activeLanguage),
  );
  // 语言服务安装状态：null 未知 / false 未安装（驱动「点击安装」引导）
  const [lspInstalled, setLspInstalled] = useState<boolean | null>(null);
  // 扩展 set-status-message 的临时消息（自动消失）
  const [extensionStatusMessage, setExtensionStatusMessage] = useState<string | null>(null);
  const signedInProfile = account.phase === "signedIn" ? account.profile : null;
  const accountDisplayName =
    signedInProfile?.preferredUsername || signedInProfile?.name || t("account.defaultDisplayName");

  const leftItems = StatusBarRegistry.getLeftItems();
  const rightItems = StatusBarRegistry.getRightItems();

  useEffect(() => {
    const client = LspClient.getInstance();
    const update = () => setLanguageServer(client.getState(activeLanguage));
    update();
    return client.subscribe(update);
  }, [activeLanguage]);

  // 安装状态查询：随语言/文件切换刷新，工具链装卸后由 toolchains:changed 驱动
  useEffect(() => {
    if (!activeFilePath) {
      setLspInstalled(null);
      return;
    }
    // javascript 与 typescript 共用同一语言服务，按 typescript 查询
    const target = activeLanguage === "javascript" ? "typescript" : activeLanguage;
    let cancelled = false;
    const query = () => {
      LanguageServerIPC.toolchainStatus(target)
        .then((status) => {
          if (!cancelled) setLspInstalled(Boolean(status.isLspInstalled));
        })
        .catch(() => {
          if (!cancelled) setLspInstalled(null);
        });
    };
    query();
    const unsub = EventBus.on("toolchains:changed", query);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [activeLanguage, activeFilePath]);

  // 扩展状态栏消息：4s 自动消失，新消息重置计时
  useEffect(() => {
    return EventBus.on("extension:status-message", ({ message }) => {
      setExtensionStatusMessage(message);
    });
  }, []);
  useEffect(() => {
    if (!extensionStatusMessage) return;
    const timer = window.setTimeout(() => setExtensionStatusMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [extensionStatusMessage]);

  return (
    <footer className="flex h-[var(--StatusBarHeight)] shrink-0 items-center bg-transparent px-4 text-xs text-[var(--color-text-muted)] font-medium overflow-hidden">
      <div className="flex items-center gap-3 min-w-0">
        {extensionStatusMessage ? (
          <span className="cursor-default truncate text-[var(--color-text-highlight)]">
            {extensionStatusMessage}
          </span>
        ) : (
          <span className="cursor-default truncate">
            {editorStatus.errors} {t("statusBar.errors")}, {editorStatus.warnings}{" "}
            {t("statusBar.warnings")}
          </span>
        )}
        {activeFilePath && editorStatus.hasEditor && (
          <span className="cursor-default truncate">
            {t("statusBar.line")} {editorStatus.line}, {t("statusBar.column")} {editorStatus.column}
            {editorStatus.selectionLength > 0
              ? ` (${editorStatus.selectionLength} ${t("statusBar.selected")})`
              : ""}
          </span>
        )}
        {leftItems.map((item) => (
          <DynamicStatusBarItem key={item.id} item={item} />
        ))}
      </div>
      <div className="ml-auto hidden sm:flex items-center gap-3 min-w-0">
        {rightItems.map((item) => (
          <DynamicStatusBarItem key={item.id} item={item} />
        ))}
        {signedInProfile && (
          <button
            type="button"
            onClick={() => {
              void CommandRegistry.execute("workbench.action.openSettings");
              EventBus.emit("settings:nav", "accountCloud");
            }}
            className="flex max-w-[180px] items-center gap-2 rounded-control px-1.5 py-0.5 hover:bg-[var(--material-interactive-hover)] cursor-pointer"
          >
            <AccountAvatar name={accountDisplayName} picture={signedInProfile.picture} size={20} />
            <span className="max-w-[120px] truncate text-[var(--color-text-highlight)]">
              {accountDisplayName}
            </span>
          </button>
        )}
        {activeFilePath && (
          <>
            <span className="cursor-default">{editorStatus.encoding}</span>
            <span className="cursor-default">{editorStatus.lineEnding}</span>
            <span className="cursor-default">
              {editorStatus.insertSpaces ? t("statusBar.spaces") : "Tab"}: {editorStatus.tabSize}
            </span>
            <span className="cursor-default truncate">{formatLanguage(activeLanguage)}</span>
            <Tooltip
              content={getLspTooltip(activeLanguage, languageServer, lspInstalled)}
              placement="top"
              delay={200}
            >
              <button
                type="button"
                onClick={() => {
                  if (lspInstalled === false) {
                    useWorkbenchStore.getState().setActiveSidebar("extensions");
                    EventBus.emit("marketplace:navigate", { mode: "toolchains" });
                    return;
                  }
                  setActiveBottomPanel("output");
                }}
                aria-label={getLspTooltip(activeLanguage, languageServer, lspInstalled)}
                className="flex h-5 w-5 items-center justify-center rounded-control hover:bg-[var(--material-interactive-hover)] cursor-pointer"
              >
                <span
                  className={`h-2 w-2 rounded-full transition-all ${languageServerStatusColor(languageServer?.status, lspInstalled === false)}`}
                />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </footer>
  );
}

function getLspTooltip(
  activeLanguage: string,
  languageServer?: LanguageServerInfo | null,
  lspInstalled?: boolean | null,
): string {
  const languageName = formatLanguage(activeLanguage);
  const text = (key: Parameters<typeof LocaleService.translate>[0]) =>
    LocaleService.translate(key).replace("{language}", languageName);
  if (lspInstalled === false) {
    return text("statusBar.lspNotInstalled");
  }
  if (!languageServer || languageServer.status === "stopped") {
    return text("statusBar.lspTooltipStopped");
  }
  if (languageServer.status === "running") {
    return text("statusBar.lspTooltipRunning");
  }
  if (languageServer.status === "failed") {
    // 错误详情在 output 面板，tooltip 不裸露报错码
    return text("statusBar.lspTooltipFailed");
  }
  if (
    languageServer.status === "starting" ||
    languageServer.status === "initializing" ||
    languageServer.status === "restarting"
  ) {
    return text("statusBar.lspTooltipStarting");
  }
  return `${languageName}: ${LocaleService.translate("statusBar.lspTooltipNotConfigured")}`;
}

function languageServerStatusColor(
  status?: LanguageServerInfo["status"],
  notInstalled?: boolean,
): string {
  if (notInstalled) {
    return "bg-[var(--color-text-muted)]/50";
  }
  if (status === "running") {
    return "bg-[var(--StatusSuccess)] shadow-[0_0_6px_var(--StatusSuccess)]";
  }
  if (status === "failed") {
    return "bg-[var(--StatusError)] shadow-[0_0_6px_var(--StatusError)]";
  }
  if (status === "starting" || status === "initializing" || status === "restarting") {
    return "bg-[var(--StatusWarning)] animate-pulse shadow-[0_0_6px_var(--StatusWarning)]";
  }
  return "bg-[var(--color-text-muted)]/80";
}
