import { useEffect, useState, useSyncExternalStore } from "react";
import { AccountService } from "../Core/AccountService";
import { type LanguageServerInfo, LspClient } from "../Core/Language/LspClient";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { EventBus } from "../Foundation/EventBus";
import { GetLanguageFromPath } from "../Shared/Utils/LanguageUtils";
import { useEditorStore } from "../State/useEditorStore";
import { useWorkbenchStore } from "../State/useWorkspaceStore";
import { AccountAvatar } from "../UI/Components/AccountAvatar";

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
  const account = useSyncExternalStore(
    AccountService.subscribe,
    AccountService.getSnapshot,
    AccountService.getSnapshot,
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
    signedInProfile?.preferredUsername || signedInProfile?.name || "Aurona 用户";

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
          {editorStatus.errors} 错误, {editorStatus.warnings} 警告
        </span>
        {activeFilePath && editorStatus.hasEditor && (
          <span className="cursor-default truncate">
            行 {editorStatus.line}, 列 {editorStatus.column}
            {editorStatus.selectionLength > 0 ? ` (${editorStatus.selectionLength} 已选)` : ""}
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
              {editorStatus.insertSpaces ? "空格" : "Tab"}: {editorStatus.tabSize}
            </span>
            <span className="cursor-default truncate">{formatLanguage(activeLanguage)}</span>
            <button
              type="button"
              onClick={() => setActiveBottomPanel("output")}
              aria-label={languageServer?.lastError ?? "打开语言服务器输出"}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-[var(--material-interactive-hover)]"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${languageServerStatusColor(languageServer?.status)}`}
              />
              <span>{languageServerStatusLabel(languageServer?.status)}</span>
            </button>
          </>
        )}
      </div>
    </footer>
  );
}

function languageServerStatusLabel(status?: LanguageServerInfo["status"]): string {
  if (!status) return "语言服务未配置";
  return {
    stopped: "语言服务已停止",
    starting: "语言服务启动中",
    initializing: "语言服务初始化中",
    running: "语言服务运行中",
    restarting: "语言服务重启中",
    failed: "语言服务失败",
    stopping: "语言服务停止中",
  }[status];
}

function languageServerStatusColor(status?: LanguageServerInfo["status"]): string {
  if (status === "running") return "bg-emerald-500";
  if (status === "failed") return "bg-red-500";
  if (status === "starting" || status === "initializing" || status === "restarting") {
    return "bg-amber-500 animate-pulse";
  }
  return "bg-[var(--color-text-muted)]";
}
