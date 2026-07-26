import { useEffect, useState } from "react";
import { type LanguageServerInfo, LspClient } from "../Features/Editor/LspClient";
import { useEditorStore } from "../State/useEditorStore";
import { useWorkbenchStore } from "../State/useWorkspaceStore";

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
  const editorStatus = useEditorStore((state) => state.editorStatus);
  const setActiveBottomPanel = useWorkbenchStore((state) => state.setActiveBottomPanel);
  const [languageServer, setLanguageServer] = useState<LanguageServerInfo | undefined>(() =>
    LspClient.getInstance().getState(editorStatus.language),
  );

  useEffect(() => {
    const client = LspClient.getInstance();
    const update = () => setLanguageServer(client.getState(editorStatus.language));
    update();
    return client.subscribe(update);
  }, [editorStatus.language]);

  return (
    <footer className="flex h-[var(--StatusBarHeight)] shrink-0 items-center bg-transparent px-4 text-xs text-[var(--TextMuted)] font-medium overflow-hidden">
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
            <button
              type="button"
              onClick={() => setActiveBottomPanel("output")}
              aria-label={languageServer?.lastError ?? "打开语言服务器输出"}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-[var(--GlassHover)]"
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
  return "bg-[var(--TextMuted)]";
}
