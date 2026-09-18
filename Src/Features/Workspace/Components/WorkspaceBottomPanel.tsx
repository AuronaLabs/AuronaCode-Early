import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { DebugService } from "../../../Core/DebugService";
import { collectProblems, DiagnosticsService } from "../../../Core/DiagnosticsService";
import { type OutputChannelId, OutputService } from "../../../Core/OutputService";
import { TerminalManager } from "../../../Core/TerminalService";
import { EventBus } from "../../../Foundation/EventBus";
import { useLocale } from "../../../Foundation/I18n";
import { LazyChunkBoundary, lazyChunk } from "../../../Layout/LazyChunkBoundary";
import { GetLanguageFromPath } from "../../../Shared/Utils/LanguageUtils";
import { fileUriToPath } from "../../../Shared/Utils/UriUtils";
import { useTerminalStore } from "../../../State/useTerminalStore";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";
import { Badge } from "../../../UI/Components/Badge";
import { Button } from "../../../UI/Components/Button";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "../../../UI/Components/DropdownMenu";
import { Select } from "../../../UI/Components/Select";
import { showToast } from "../../../UI/Feedback/Toast";
import { Tooltip } from "../../../UI/Feedback/Tooltip";
import { Icons } from "../../../UI/Icons/IconManager";
import { LocationResultsPanel } from "../../Language/LocationResultsPanel";

type TerminalViewProps = {
  id: string;
  isActive: boolean;
  shellProfile?: import("../../../Core/TerminalService").ShellProfile;
  cwd?: string;
};

const TerminalView = lazyChunk<TerminalViewProps>(() =>
  import("../../Terminal/TerminalView").then((module) => ({ default: module.TerminalView })),
);

export function WorkspaceBottomPanel() {
  const { t } = useLocale();

  const isBottomPanelOpen = useWorkbenchStore((state) => state.isBottomPanelOpen);
  const setBottomPanelOpen = useWorkbenchStore((state) => state.setBottomPanelOpen);
  const activeBottomPanel = useWorkbenchStore((state) => state.activeBottomPanel);
  const setActiveBottomPanel = useWorkbenchStore((state) => state.setActiveBottomPanel);
  const tabs = useWorkbenchStore((state) => state.tabs);
  const activeTabId = useWorkbenchStore((state) => state.activeTabId);
  const openFile = useWorkbenchStore((state) => state.openFile);
  const requestReveal = useWorkbenchStore((state) => state.requestReveal);

  const activeFilePath = tabs.find((tab) => tab.id === activeTabId && tab.type === "file")?.path;

  // 终端状态
  const terminals = useTerminalStore((state) => state.terminals);
  const activeTerminalId = useTerminalStore((state) => state.activeTerminalId);
  const availableShells = useTerminalStore((state) => state.availableShells);
  const isTerminalListVisible = useTerminalStore((state) => state.isTerminalListVisible);
  const setIsTerminalListVisible = useTerminalStore((state) => state.setIsTerminalListVisible);

  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isShellDropdownOpen, setIsShellDropdownOpen] = useState(false);
  const [terminalStartupError, setTerminalStartupError] = useState<string | null>(null);

  // 输出状态
  const [activeOutputChannel, setActiveOutputChannel] = useState<OutputChannelId | "all">("all");
  const [outputRevision, setOutputRevision] = useState(0);

  // 诊断问题状态
  const [diagnosticsRevision, setDiagnosticsRevision] = useState(0);
  const [problemsScope, setProblemsScope] = useState<"file" | "workspace">("file");

  // 调试控制台状态
  const [debugConsoleInput, setDebugConsoleInput] = useState("");
  const [debugConsoleHistory, setDebugConsoleHistory] = useState<string[]>([]);
  const [debugConsoleHistoryIndex, setDebugConsoleHistoryIndex] = useState(-1);

  useEffect(() => {
    return DiagnosticsService.subscribe(() =>
      setDiagnosticsRevision(DiagnosticsService.getRevision()),
    );
  }, []);

  useEffect(() => {
    return OutputService.subscribe(() => setOutputRevision((value) => value + 1));
  }, []);

  const ensureTerminal = useCallback(async () => {
    setTerminalStartupError(null);
    try {
      await TerminalManager.ensureDefaultTerminal();
    } catch (error) {
      setTerminalStartupError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (isBottomPanelOpen && activeBottomPanel === "terminal" && terminals.length === 0) {
      void ensureTerminal();
    }
  }, [activeBottomPanel, ensureTerminal, isBottomPanelOpen, terminals.length]);

  const problems = useMemo(() => {
    void diagnosticsRevision;
    return collectProblems(DiagnosticsService.getAll(), problemsScope, activeFilePath);
  }, [activeFilePath, diagnosticsRevision, problemsScope]);

  const MAX_VISIBLE_PROBLEMS = 500;
  const visibleProblems = problems.slice(0, MAX_VISIBLE_PROBLEMS);

  const problemCounts = useMemo(() => {
    const counts = new Map<string, { errors: number; warnings: number }>();
    for (const problem of problems) {
      const current = counts.get(problem.uri) ?? { errors: 0, warnings: 0 };
      if (problem.severity === 1) current.errors += 1;
      else current.warnings += 1;
      counts.set(problem.uri, current);
    }
    return counts;
  }, [problems]);

  const outputChannel =
    activeOutputChannel === "all"
      ? {
          id: "all",
          label: t("workspace.outputAllLabel"),
          entries: OutputService.getChannels()
            .flatMap((channel) => channel.entries)
            .sort((left, right) => left.id - right.id),
          bytes: OutputService.getChannels().reduce((total, channel) => total + channel.bytes, 0),
          revision: outputRevision,
        }
      : OutputService.getChannel(activeOutputChannel);

  const submitDebugConsole = async () => {
    const expression = debugConsoleInput.trim();
    if (!expression) return;
    setDebugConsoleHistory((history) => [expression, ...history].slice(0, 50));
    setDebugConsoleHistoryIndex(-1);
    setDebugConsoleInput("");
    OutputService.append("debug-adapter", `> ${expression}`, "info");
    try {
      const result = await DebugService.evaluate(expression, "repl");
      OutputService.append("debug-adapter", result.value, "info");
    } catch (error) {
      OutputService.append(
        "debug-adapter",
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  };

  if (!isBottomPanelOpen) return null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden select-none">
      {/* 顶部标签导航栏 */}
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${
              activeBottomPanel === "terminal"
                ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--material-interactive-hover)]"
            }`}
            onClick={() => setActiveBottomPanel("terminal")}
          >
            <Icons.Terminal size={14} />
            <span>{t("bottomPanel.terminal")}</span>
          </button>
          <button
            type="button"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${
              activeBottomPanel === "output"
                ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--material-interactive-hover)]"
            }`}
            onClick={() => setActiveBottomPanel("output")}
          >
            <Icons.FileText size={14} />
            <span>{t("bottomPanel.output")}</span>
          </button>
          <button
            type="button"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${
              activeBottomPanel === "debug-console"
                ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--material-interactive-hover)]"
            }`}
            onClick={() => setActiveBottomPanel("debug-console")}
          >
            <Icons.Debug size={14} />
            <span>{t("bottomPanel.debugConsole")}</span>
          </button>
          <button
            type="button"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${
              activeBottomPanel === "problems"
                ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--material-interactive-hover)]"
            }`}
            onClick={() => setActiveBottomPanel("problems")}
          >
            <Icons.AlertTriangle size={14} />
            <span>{t("bottomPanel.problems")}</span>
            {problems.length > 0 && (
              <Badge variant="solid" color="var(--StatusError)" className="ml-1">
                {problems.length}
              </Badge>
            )}
          </button>
          <button
            type="button"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${
              activeBottomPanel === "references"
                ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--material-interactive-hover)]"
            }`}
            onClick={() => setActiveBottomPanel("references")}
          >
            <Icons.Search size={14} />
            <span>{t("bottomPanel.references")}</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {activeBottomPanel === "terminal" && (
            <div className="flex items-center gap-1 mr-2 border-r border-[var(--border-subtle)] pr-2">
              <Tooltip
                content={
                  isTerminalListVisible ? t("workspace.terminalList") : t("workspace.terminalList")
                }
                delay={300}
                placement="top"
              >
                <button
                  type="button"
                  className={`flex h-[26px] w-[26px] items-center justify-center rounded-lg transition-colors ${
                    isTerminalListVisible
                      ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)]"
                  }`}
                  onClick={() => setIsTerminalListVisible(!isTerminalListVisible)}
                >
                  <Icons.List size={14} />
                </button>
              </Tooltip>

              <div className="relative flex items-center pr-4">
                <Tooltip content={t("workspace.newTerminal")} delay={300} placement="top">
                  <button
                    type="button"
                    className="flex h-[26px] w-[26px] items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)] rounded-lg transition-colors"
                    onClick={() => TerminalManager.createTerminal()}
                  >
                    <Icons.Plus size={14} />
                  </button>
                </Tooltip>
                <DropdownMenuRoot open={isShellDropdownOpen} onOpenChange={setIsShellDropdownOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-[26px] w-[16px] items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)] rounded-lg transition-colors absolute -right-4 top-0"
                    >
                      <Icons.ChevronDown size={10} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4}>
                    {availableShells.map((shell) => (
                      <DropdownMenuItem
                        key={shell.id}
                        className="text-[12px] cursor-pointer"
                        onClick={() => {
                          TerminalManager.createTerminal(shell.id);
                          setIsShellDropdownOpen(false);
                        }}
                      >
                        {shell.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenuRoot>
              </div>
            </div>
          )}

          <Tooltip content={t("workspace.minimizePanel")} delay={300} placement="top">
            <button
              type="button"
              className="flex h-[26px] w-[26px] items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)] rounded-lg transition-colors"
              onClick={() => setBottomPanelOpen(false)}
            >
              <Icons.Minimize size={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 内容容器 */}
      <div className="flex-1 relative overflow-hidden bg-transparent border-t border-[var(--border-subtle)] flex">
        {/* 终端视图 */}
        <div
          className="flex-1 relative"
          style={{ display: activeBottomPanel === "terminal" ? "block" : "none" }}
        >
          {terminalStartupError && terminals.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
              <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--material-panel)] p-5 text-center">
                <Icons.AlertTriangle size={20} className="text-[var(--StatusWarning)]" />
                <div className="text-[13px] font-medium text-[var(--color-text-highlight)]">
                  {t("terminal.failed")}
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)]">
                  {terminalStartupError}
                </div>
                <Button variant="glass" onClick={() => void ensureTerminal()}>
                  {t("common.retry")}
                </Button>
              </div>
            </div>
          )}
          {terminals.map((term) => (
            <div
              key={term.id}
              className="absolute inset-0"
              style={{
                visibility: activeTerminalId === term.id ? "visible" : "hidden",
                zIndex: activeTerminalId === term.id ? 1 : 0,
              }}
            >
              <LazyChunkBoundary modulePath="Src/Features/Terminal/TerminalView.tsx">
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center w-full h-full text-[var(--color-text-muted)] text-xs">
                      {t("terminal.starting")}
                    </div>
                  }
                >
                  <TerminalView
                    id={term.id}
                    isActive={activeBottomPanel === "terminal" && activeTerminalId === term.id}
                    shellProfile={term.shell}
                    cwd={term.cwd}
                  />
                </Suspense>
              </LazyChunkBoundary>
            </div>
          ))}
        </div>

        {activeBottomPanel === "terminal" && isTerminalListVisible && (
          <div className="w-48 shrink-0 bg-transparent border-l border-[var(--border-subtle)] flex flex-col p-1 gap-0.5 overflow-y-auto no-scrollbar relative z-20">
            {terminals.map((term) => (
              <div
                key={term.id}
                role="option"
                aria-selected={activeTerminalId === term.id}
                tabIndex={0}
                onClick={() => TerminalManager.setActiveTerminal(term.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    TerminalManager.setActiveTerminal(term.id);
                  }
                }}
                onDoubleClick={() => {
                  setEditingTerminalId(term.id);
                  setEditingName(term.name);
                }}
                className={`group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer select-none transition-colors ${
                  activeTerminalId === term.id
                    ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
                }`}
              >
                <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                  <Icons.Terminal size={14} className="shrink-0" />
                  {editingTerminalId === term.id ? (
                    <input
                      type="text"
                      data-aurona-input="embedded"
                      value={editingName}
                      className="bg-transparent outline-none w-full text-[12px] text-[var(--color-text-highlight)]"
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => {
                        TerminalManager.renameTerminal(term.id, editingName);
                        setEditingTerminalId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          TerminalManager.renameTerminal(term.id, editingName);
                          setEditingTerminalId(null);
                        }
                        if (e.key === "Escape") setEditingTerminalId(null);
                      }}
                    />
                  ) : (
                    <span className="text-[12px] truncate">{term.name}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--material-interactive-hover)] rounded transition-all shrink-0 ml-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    TerminalManager.removeTerminal(term.id);
                  }}
                >
                  <Icons.Trash
                    size={12}
                    className="text-[var(--StatusError)]/80 hover:text-[var(--StatusError)]"
                  />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 诊断问题视图 */}
        {activeBottomPanel === "problems" && (
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-3 py-1.5">
              {(["file", "workspace"] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setProblemsScope(scope)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    problemsScope === scope
                      ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  {scope === "file"
                    ? t("bottomPanel.problemsScopeFile")
                    : t("bottomPanel.problemsScopeWorkspace")}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col items-start gap-1 no-scrollbar">
              {problems.length > 0 ? (
                <>
                  {visibleProblems.map((problem, index) => {
                    const path = fileUriToPath(problem.uri);
                    const showGroupHeader =
                      problemsScope === "workspace" &&
                      (index === 0 || visibleProblems[index - 1]?.uri !== problem.uri);
                    const counts = problemCounts.get(problem.uri);
                    return (
                      <div key={problem.key} className="flex w-full flex-col gap-1">
                        {showGroupHeader && (
                          <div className="flex w-full items-center gap-2 rounded-lg bg-[var(--material-surface)] px-2 py-1 text-[10px]">
                            <span className="min-w-0 flex-1 truncate font-mono text-[var(--color-text-muted)]">
                              {path ?? problem.uri}
                            </span>
                            {counts && (
                              <span className="shrink-0 text-[var(--color-text-muted)]">
                                {counts.errors} {t("statusBar.errors")} · {counts.warnings}{" "}
                                {t("statusBar.warnings")}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="group flex w-full items-start gap-2 rounded-lg p-2 transition-colors hover:bg-[var(--material-interactive-hover)]">
                          <button
                            type="button"
                            onClick={() => {
                              if (!path) return;
                              openFile(path);
                              requestReveal(path, problem.range.start.line + 1);
                            }}
                            className="flex min-w-0 flex-1 items-start gap-2 text-left"
                          >
                            <div
                              className={`mt-0.5 shrink-0 flex items-center justify-center p-0.5 rounded ${
                                problem.severity === 1
                                  ? "bg-[var(--StatusError)]/10 text-[var(--StatusError)]"
                                  : "bg-[var(--StatusWarning)]/10 text-[var(--StatusWarning)]"
                              }`}
                            >
                              <Icons.AlertTriangle size={14} stroke={2} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] font-medium text-[var(--color-text-highlight)] whitespace-pre-wrap">
                                {problem.message}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)] font-mono">
                                {path ?? problem.uri} · [{problem.source || "aurona"}] Ln{" "}
                                {problem.range.start.line + 1}, Col{" "}
                                {problem.range.start.character + 1}
                              </span>
                            </div>
                          </button>
                          <Tooltip content={t("language.quickFix")} delay={300} placement="top">
                            <button
                              type="button"
                              aria-label={t("language.quickFix")}
                              onClick={() => {
                                if (!path) return;
                                EventBus.emit("language:code-actions-request", {
                                  path,
                                  language: GetLanguageFromPath(path),
                                  line: problem.range.start.line,
                                  character: problem.range.start.character,
                                });
                              }}
                              className="mt-0.5 shrink-0 rounded-md p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] group-hover:opacity-100"
                            >
                              <Icons.Sparkles size={14} stroke={1.8} />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    );
                  })}
                  {problems.length > visibleProblems.length && (
                    <div className="w-full px-3 pb-1 text-[10px] text-[var(--color-text-muted)]">
                      {t("bottomPanel.problemsTruncated")
                        .replace("{shown}", String(visibleProblems.length))
                        .replace("{total}", String(problems.length))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center w-full h-full gap-2 opacity-50">
                  <Icons.Checks size={32} stroke={1} />
                  <span className="text-[13px]">
                    {problemsScope === "workspace"
                      ? t("bottomPanel.workspaceEmpty")
                      : activeFilePath
                        ? t("bottomPanel.fileEmpty")
                        : t("bottomPanel.noFileOpen")}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 引用位置视图 */}
        {activeBottomPanel === "references" && (
          <div className="absolute inset-0">
            <LocationResultsPanel />
          </div>
        )}

        {/* 日志输出视图 */}
        {activeBottomPanel === "output" && (
          <div className="absolute inset-0 flex flex-col font-mono text-[12px] text-[var(--color-text-muted)]">
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
              <Select
                ariaLabel={t("workspace.outputSource")}
                value={activeOutputChannel}
                onChange={(value) => setActiveOutputChannel(value as OutputChannelId | "all")}
                options={[
                  { value: "all", label: t("workspace.outputAllLabel") },
                  ...OutputService.getChannels().map((channel) => ({
                    value: channel.id,
                    label: channel.label,
                  })),
                ]}
                className="h-7 min-w-[150px] rounded-lg font-sans text-[12px]"
              />
              <button
                type="button"
                onClick={() => {
                  if (activeOutputChannel === "all") {
                    for (const channel of OutputService.getChannels()) {
                      OutputService.clear(channel.id);
                    }
                  } else {
                    OutputService.clear(activeOutputChannel);
                  }
                }}
                className="rounded-lg px-2 py-1 hover:bg-[var(--material-interactive-hover)]"
              >
                {t("common.clear")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const selectedText = window.getSelection()?.toString().trim();
                  const text =
                    selectedText ||
                    outputChannel.entries
                      .map(
                        (entry) =>
                          `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.message}`,
                      )
                      .join("\n");
                  void navigator.clipboard
                    .writeText(text)
                    .then(() => showToast(t("workspace.outputCopied"), "success"))
                    .catch((error) =>
                      showToast(
                        `${t("workspace.copyFailed")}: ${error instanceof Error ? error.message : String(error)}`,
                        "error",
                      ),
                    );
                }}
                className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--material-interactive-hover)]"
              >
                <Icons.Copy size={12} />
                {t("common.copy")}
              </button>
              <span className="ml-auto text-[10px] opacity-70">
                {outputChannel.entries.length} 条 · {(outputChannel.bytes / 1024).toFixed(1)} KiB
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 no-scrollbar select-text cursor-text">
              {outputChannel.entries.length ? (
                outputChannel.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={
                      entry.level === "error"
                        ? "text-[var(--StatusError)]"
                        : entry.level === "warn"
                          ? "text-[var(--StatusWarning)]"
                          : ""
                    }
                  >
                    <span className="opacity-60">{entry.timestamp}</span>{" "}
                    <span className="uppercase opacity-80">[{entry.level}]</span>{" "}
                    <span className="whitespace-pre-wrap">{entry.message}</span>
                  </div>
                ))
              ) : (
                <div className="flex h-full items-center justify-center opacity-50">
                  {t("workspace.outputEmpty")}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 调试控制台视图 */}
        {activeBottomPanel === "debug-console" && (
          <div className="absolute inset-0 flex flex-col font-mono text-[12px]">
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5 text-[var(--color-text-muted)]">
              <button
                type="button"
                onClick={() => OutputService.clear("debug-adapter")}
                className="rounded-lg px-2 py-1 hover:bg-[var(--material-interactive-hover)]"
              >
                {t("common.clear")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const selectedText = window.getSelection()?.toString().trim();
                  const text =
                    selectedText ||
                    OutputService.getChannel("debug-adapter")
                      .entries.map((entry) => entry.message)
                      .join("\n");
                  if (!text) return;
                  void navigator.clipboard
                    .writeText(text)
                    .then(() => showToast(t("workspace.debugConsoleCopied"), "success"))
                    .catch((error) =>
                      showToast(
                        `${t("workspace.copyFailed")}: ${error instanceof Error ? error.message : String(error)}`,
                        "error",
                      ),
                    );
                }}
                className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--material-interactive-hover)]"
              >
                <Icons.Copy size={12} />
                {t("common.copy")}
              </button>
              <span className="ml-auto text-[10px] opacity-70">
                {OutputService.getChannel("debug-adapter").entries.length} 条
              </span>
            </div>
            <div className="selectable min-h-0 flex-1 cursor-text overflow-y-auto p-3 no-scrollbar">
              {OutputService.getChannel("debug-adapter").entries.length ? (
                OutputService.getChannel("debug-adapter").entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={
                      entry.level === "error"
                        ? "whitespace-pre-wrap text-[var(--StatusError)]"
                        : entry.level === "warn"
                          ? "whitespace-pre-wrap text-[var(--StatusWarning)]"
                          : "whitespace-pre-wrap text-[var(--color-text-muted)]"
                    }
                  >
                    {entry.message}
                  </div>
                ))
              ) : (
                <div className="flex h-full select-none items-center justify-center text-[var(--color-text-muted)] opacity-60">
                  {t("workspace.debugConsoleEmpty")}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-1.5 transition-[border-color,box-shadow] focus-within:border-[var(--color-text-muted)]/25 focus-within:shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--color-text-muted)_14%,transparent)]">
              <span className="select-none text-[13px] font-bold text-[var(--color-accent)]">
                &gt;
              </span>
              <input
                data-aurona-input="embedded"
                value={debugConsoleInput}
                onChange={(event) => {
                  setDebugConsoleInput(event.target.value);
                  setDebugConsoleHistoryIndex(-1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitDebugConsole();
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    const next = Math.min(
                      debugConsoleHistoryIndex + 1,
                      debugConsoleHistory.length - 1,
                    );
                    if (debugConsoleHistory[next]) {
                      setDebugConsoleHistoryIndex(next);
                      setDebugConsoleInput(debugConsoleHistory[next] as string);
                    }
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    const next = debugConsoleHistoryIndex - 1;
                    if (next < 0) {
                      setDebugConsoleHistoryIndex(-1);
                      setDebugConsoleInput("");
                    } else if (debugConsoleHistory[next]) {
                      setDebugConsoleHistoryIndex(next);
                      setDebugConsoleInput(debugConsoleHistory[next] as string);
                    }
                  }
                }}
                placeholder={t("debug.evaluatePlaceholder")}
                className="h-6 min-w-0 flex-1 bg-transparent font-mono text-[11px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
