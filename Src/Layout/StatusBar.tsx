import { useEffect, useState, useSyncExternalStore } from "react";
import { AccountService } from "../Core/AccountService";
import { type LanguageServerInfo, LspClient } from "../Core/Language/LspClient";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { EventBus } from "../Foundation/EventBus";
import { LocaleService, useLocale } from "../Foundation/I18n";
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

export function StatusBar() {
  const { t } = useLocale();
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
  const signedInProfile = account.phase === "signedIn" ? account.profile : null;
  const accountDisplayName =
    signedInProfile?.preferredUsername || signedInProfile?.name || t("account.defaultDisplayName");

  useEffect(() => {
    const client = LspClient.getInstance();
    const update = () => setLanguageServer(client.getState(activeLanguage));
    update();
    return client.subscribe(update);
  }, [activeLanguage]);

  return (
    <footer className="flex h-[var(--StatusBarHeight)] shrink-0 items-center bg-transparent px-4 text-xs text-[var(--color-text-muted)] font-medium overflow-hidden">
      <div className="flex items-center gap-4 min-w-0">
        <span className="cursor-default truncate">
          {editorStatus.errors} {t("statusBar.errors")}, {editorStatus.warnings}{" "}
          {t("statusBar.warnings")}
        </span>
        {activeFilePath && editorStatus.hasEditor && (
          <span className="cursor-default truncate">
            {t("statusBar.line")} {editorStatus.line}, {t("statusBar.column")} {editorStatus.column}
            {editorStatus.selectionLength > 0
              ? ` (${editorStatus.selectionLength} ${t("statusBar.selected")})`
              : ""}
          </span>
        )}
      </div>
      <div className="ml-auto hidden sm:flex items-center gap-4 min-w-0">
        {signedInProfile && (
          <button
            type="button"
            onClick={() => {
              void CommandRegistry.execute("workbench.action.openSettings");
              EventBus.emit("settings:nav", "accountCloud");
            }}
            className="flex max-w-[180px] items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-[var(--material-interactive-hover)]"
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
              content={getLspTooltip(activeLanguage, languageServer)}
              placement="top"
              delay={200}
            >
              <button
                type="button"
                onClick={() => setActiveBottomPanel("output")}
                aria-label={getLspTooltip(activeLanguage, languageServer)}
                className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-[var(--material-interactive-hover)] cursor-pointer"
              >
                <span
                  className={`h-2 w-2 rounded-full transition-all ${languageServerStatusColor(languageServer?.status)}`}
                />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </footer>
  );
}

function getLspTooltip(activeLanguage: string, languageServer?: LanguageServerInfo | null): string {
  const languageName = formatLanguage(activeLanguage);
  if (!languageServer || languageServer.status === "stopped") {
    return `${languageName}: ${LocaleService.translate("statusBar.lspTooltipStopped")}`;
  }
  if (languageServer.status === "running") {
    return `${languageName}: ${LocaleService.translate("statusBar.lspTooltipRunning")}`;
  }
  if (languageServer.status === "failed") {
    return languageServer.lastError
      ? `${languageName}: ${languageServer.lastError}`
      : `${languageName}: ${LocaleService.translate("statusBar.lspTooltipFailed")}`;
  }
  if (
    languageServer.status === "starting" ||
    languageServer.status === "initializing" ||
    languageServer.status === "restarting"
  ) {
    return `${languageName}: ${LocaleService.translate("statusBar.lspTooltipStarting")}`;
  }
  return `${languageName}: ${LocaleService.translate("statusBar.lspTooltipNotConfigured")}`;
}

function languageServerStatusColor(status?: LanguageServerInfo["status"]): string {
  if (status === "running") {
    return "bg-[var(--StatusSuccess)] shadow-[0_0_6px_var(--StatusSuccess)]";
  }
  if (status === "failed") {
    return "bg-[var(--StatusError)] shadow-[0_0_6px_var(--StatusError)]";
  }
  if (status === "starting" || status === "initializing" || status === "restarting") {
    return "bg-[var(--StatusWarning)] animate-pulse shadow-[0_0_6px_var(--StatusWarning)]";
  }
  return "bg-zinc-400/80 dark:bg-zinc-500/80";
}
