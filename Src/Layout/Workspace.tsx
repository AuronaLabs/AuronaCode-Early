import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DebugService } from "../Core/DebugService";
import { collectProblems, DiagnosticsService } from "../Core/DiagnosticsService";
import { DocumentSymbolService } from "../Core/Language/DocumentSymbolService";
import { LspClient } from "../Core/Language/LspClient";
import {
  type DocumentSymbolNode,
  type FlattenedSymbol,
  flattenDocumentSymbols,
} from "../Core/Language/SymbolUtils";
import { LanguageConfigurationService } from "../Core/LanguageConfigurationService";
import {
  type LanguageCodeAction,
  LanguageFeatureService,
  type WorkspaceEdit,
  type WorkspaceEditPreview,
} from "../Core/LanguageFeatureService";
import { type OutputChannelId, OutputService } from "../Core/OutputService";
import { RecoveryCoordinator } from "../Core/Recovery/RecoveryCoordinator";
import { TerminalManager } from "../Core/TerminalService";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { EditorTabBar } from "../Features/Editor/EditorTabBar";
import { ExtensionSidebar } from "../Features/Extensions/ExtensionSidebar";
import { ExtensionsPanel } from "../Features/Extensions/ExtensionsPanel";
import { FliunoWorkspacePage } from "../Features/Fliuno/FliunoWorkspacePage";
import { LocationResultsPanel } from "../Features/Language/LocationResultsPanel";
import { OutlineView } from "../Features/Language/OutlineView";
import { WorkspaceEditPreviewList } from "../Features/Language/WorkspaceEditPreviewList";
import { AboutTab } from "../Features/Settings/AboutTab";
import { ChangelogTab } from "../Features/Settings/ChangelogTab";
import { PerformanceBenchmarkPage } from "../Features/Settings/PerformanceBenchmarkPage";
import { SettingsTab } from "../Features/Settings/SettingsTab";
import { EventBus } from "../Foundation/EventBus";
import { useLocale } from "../Foundation/I18n";
import type { TabItem } from "../Foundation/Types/Tab";
import {
  extensionIdFromSidebar,
  SIDEBAR_DEBUG,
  SIDEBAR_EXPLORER,
  SIDEBAR_EXTENSIONS,
  SIDEBAR_NOTIFICATIONS,
  SIDEBAR_OUTLINE,
  SIDEBAR_SOURCE_CONTROL,
} from "../Shared/Constants/Sidebar";
import { GetLanguageFromPath } from "../Shared/Utils/LanguageUtils";
import { fileUriToPath } from "../Shared/Utils/UriUtils";
import { useTerminalStore } from "../State/useTerminalStore";
import {
  DEFAULT_BOTTOM_PANEL_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  useWorkbenchStore,
} from "../State/useWorkspaceStore";
import { Button } from "../UI/Components/Button";
import { Card } from "../UI/Components/Card";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "../UI/Components/DropdownMenu";
import { Modal } from "../UI/Components/Modal";
import { PanelResizeHandle } from "../UI/Components/PanelResizeHandle";
import { Select } from "../UI/Components/Select";
import { showToast } from "../UI/Feedback/Toast";
import { Tooltip } from "../UI/Feedback/Tooltip";
import { Icons } from "../UI/Icons/IconManager";

const FileExplorer = lazy(() =>
  import("../Features/Explorer/FileExplorer").then((m) => ({ default: m.FileExplorer })),
);
const EditorTab = lazy(() =>
  import("../Features/Editor/EditorTab").then((m) => ({ default: m.EditorTab })),
);

const NotificationsPanel = lazy(() =>
  import("../Features/Notifications/NotificationsPanel").then((m) => ({
    default: m.NotificationsPanel,
  })),
);
const SourceControl = lazy(() =>
  import("../Features/SourceControl/SourceControl").then((m) => ({ default: m.SourceControl })),
);
const TerminalView = lazy(() =>
  import("../Features/Terminal/TerminalView").then((m) => ({ default: m.TerminalView })),
);
const DebugPanel = lazy(() =>
  import("../Features/Debug/DebugPanel").then((m) => ({ default: m.DebugPanel })),
);

const DiffViewer = lazy(() =>
  import("../Features/SourceControl/DiffViewer").then((m) => ({ default: m.DiffViewer })),
);

function renderTabContent(
  tab: TabItem,
  activeTabId: string | null,
  pendingReveal: { path: string; line: number } | null,
  clearPendingReveal: (path: string, line: number) => void,
) {
  let content = null;
  const isActive = activeTabId === tab.id;
  if (tab.type === "file" && tab.path) {
    content = (
      <EditorTab
        path={tab.path}
        isActive={isActive}
        revealLine={pendingReveal?.path === tab.path ? pendingReveal.line : undefined}
        onRevealHandled={clearPendingReveal}
      />
    );
  } else if (tab.type === "about") {
    content = isActive ? <AboutTab /> : null;
  } else if (tab.type === "settings") {
    content = isActive ? <SettingsTab /> : null;
  } else if (tab.type === "fliuno") {
    content = isActive ? <FliunoWorkspacePage /> : null;
  } else if (tab.type === "changelog") {
    content = isActive ? <ChangelogTab /> : null;
  } else if (tab.type === "performance") {
    content = isActive ? <PerformanceBenchmarkPage /> : null;
  } else if (tab.type === "diff" && tab.path) {
    content = isActive ? <DiffViewer diffTarget={tab.path} /> : null;
  }
  return <Suspense fallback={<div className="w-full h-full bg-transparent" />}>{content}</Suspense>;
}

export function WorkspaceView() {
  const { t } = useLocale();
  const {
    tabs,
    activeTabId,
    activeSidebar,
    sidebarWidth,
    isBottomPanelOpen,
    activeBottomPanel,
    bottomPanelHeight,
    pendingCloseTab,
    setActiveTabId,
    setPendingCloseTab,
    setSidebarWidth,
    setBottomPanelOpen,
    setActiveBottomPanel,
    setBottomPanelHeight,
    openFile,
    closeTabById,
    pendingReveal,
    requestReveal,
    clearPendingReveal,
  } = useWorkbenchStore();

  const {
    terminals,
    activeTerminalId,
    isTerminalListVisible,
    availableShells,
    isShellDropdownOpen,
    editingTerminalId,
    editingName,
    setIsTerminalListVisible,
    setIsShellDropdownOpen,
    setEditingTerminalId,
    setEditingName,
  } = useTerminalStore();

  const workspaceRef = useRef<HTMLDivElement>(null);
  const editorColumnRef = useRef<HTMLDivElement>(null);
  const [terminalStartupError, setTerminalStartupError] = useState<string | null>(null);
  const [diagnosticsRevision, setDiagnosticsRevision] = useState(DiagnosticsService.getRevision());
  const [outputRevision, setOutputRevision] = useState(0);
  const [activeOutputChannel, setActiveOutputChannel] = useState<OutputChannelId | "all">(
    "language-server",
  );
  const [renameRequest, setRenameRequest] = useState<{
    path: string;
    language: string;
    line: number;
    character: number;
  } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renamePreview, setRenamePreview] = useState<WorkspaceEditPreview | null>(null);
  const [renameEdit, setRenameEdit] = useState<WorkspaceEdit | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [codeActionLanguage, setCodeActionLanguage] = useState<string | null>(null);
  const [codeActions, setCodeActions] = useState<LanguageCodeAction[] | null>(null);
  const [codeActionError, setCodeActionError] = useState<string | null>(null);
  const [codeActionPreview, setCodeActionPreview] = useState<{
    edit: WorkspaceEdit;
    preview: WorkspaceEditPreview;
  } | null>(null);
  const [codeActionPreviewBusy, setCodeActionPreviewBusy] = useState(false);
  const [codeActionPreviewError, setCodeActionPreviewError] = useState<string | null>(null);
  const [symbolSearch, setSymbolSearch] = useState<{ path: string; language: string } | null>(null);
  const [symbols, setSymbols] = useState<FlattenedSymbol[]>([]);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [symbolIndex, setSymbolIndex] = useState(0);
  const [symbolError, setSymbolError] = useState<string | null>(null);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const [debugConsoleInput, setDebugConsoleInput] = useState("");
  const [debugConsoleHistory, setDebugConsoleHistory] = useState<string[]>([]);
  const [debugConsoleHistoryIndex, setDebugConsoleHistoryIndex] = useState(-1);
  const [problemsScope, setProblemsScope] = useState<"file" | "workspace">("file");
  const [trustRequest, setTrustRequest] = useState<{ root: string; language: string } | null>(null);
  const activeFilePath = tabs.find((tab) => tab.id === activeTabId && tab.type === "file")?.path;

  useEffect(
    () =>
      DiagnosticsService.subscribe(() => setDiagnosticsRevision(DiagnosticsService.getRevision())),
    [],
  );
  useEffect(() => EventBus.on("workspace:trust-request", setTrustRequest), []);
  useEffect(
    () =>
      EventBus.on("language:code-actions-request", (request) => {
        setCodeActionLanguage(request.language);
        setCodeActions([]);
        setCodeActionError(null);
        void LanguageFeatureService.getCodeActions(
          request.path,
          request.language,
          request.line,
          request.character,
        )
          .then(setCodeActions)
          .catch((error) => {
            setCodeActions(null);
            setCodeActionError(error instanceof Error ? error.message : String(error));
          });
      }),
    [],
  );
  useEffect(() => OutputService.subscribe(() => setOutputRevision((value) => value + 1)), []);
  useEffect(
    () =>
      EventBus.on("language:rename-request", (request) => {
        setRenameRequest(request);
        setRenameName("");
        setRenamePreview(null);
        setRenameEdit(null);
        setRenameError(null);
      }),
    [],
  );
  useEffect(
    () =>
      EventBus.on("language:symbol-search-request", ({ path, language }) => {
        setSymbolSearch({ path, language });
        setSymbolQuery("");
        setSymbolIndex(0);
        setSymbolError(null);
        void DocumentSymbolService.get(language, path)
          .then((raw) => {
            setSymbols(
              flattenDocumentSymbols(Array.isArray(raw) ? (raw as DocumentSymbolNode[]) : []),
            );
          })
          .catch((error) => {
            setSymbols([]);
            setSymbolError(error instanceof Error ? error.message : String(error));
          });
      }),
    [],
  );
  useEffect(() => {
    if (symbolSearch) symbolInputRef.current?.focus();
  }, [symbolSearch]);

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
          label: "全部 Aurona 日志",
          entries: OutputService.getChannels()
            .flatMap((channel) => channel.entries)
            .sort((left, right) => left.id - right.id),
          bytes: OutputService.getChannels().reduce((total, channel) => total + channel.bytes, 0),
          revision: outputRevision,
        }
      : OutputService.getChannel(activeOutputChannel);
  void diagnosticsRevision;
  void outputRevision;
  const filteredSymbols = useMemo(() => {
    const normalized = symbolQuery.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return symbols;
    return symbols.filter((symbol) =>
      `${symbol.name} ${symbol.detail ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalized),
    );
  }, [symbolQuery, symbols]);

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

  useEffect(
    () =>
      EventBus.on("language:open-location-results", () => {
        setActiveBottomPanel("references");
      }),
    [setActiveBottomPanel],
  );

  const handleSaveAndClose = useCallback(() => {
    if (!pendingCloseTab) return;
    setActiveTabId(pendingCloseTab.id);
  }, [pendingCloseTab, setActiveTabId]);

  useEffect(() => {
    if (pendingCloseTab && activeTabId === pendingCloseTab.id) {
      void CommandRegistry.execute("workbench.action.files.save");
    }
  }, [pendingCloseTab, activeTabId]);

  const clampSidebarWidth = useCallback((width: number) => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const available = Math.max(200, workspaceWidth - 360);
    return Math.min(Math.max(Math.round(width), 200), Math.min(520, available));
  }, []);

  const clampBottomPanelHeight = useCallback((height: number) => {
    const columnHeight =
      editorColumnRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    const available = Math.max(140, columnHeight - 160);
    return Math.min(Math.max(Math.round(height), 140), Math.min(600, available));
  }, []);

  return (
    <div
      ref={workspaceRef}
      className="flex h-full w-full overflow-hidden bg-transparent pb-1 pl-0 pr-[var(--WorkspaceGap)] text-[13px]"
    >
      {}
      <Card
        className="z-10 flex shrink-0 flex-col"
        style={{
          display: activeSidebar ? "flex" : "none",
          width: `${sidebarWidth}px`,
          minWidth: "200px",
          maxWidth: "min(520px, calc(100% - 360px))",
        }}
      >
        <div
          className="flex flex-1 flex-col min-h-0"
          style={{ display: activeSidebar === SIDEBAR_EXPLORER ? "flex" : "none" }}
        >
          <Suspense
            fallback={
              <div className="p-4 text-[var(--color-text-muted)] text-xs">
                {t("workspace.loadingExplorer")}
              </div>
            }
          >
            <FileExplorer onFileSelect={openFile} />
          </Suspense>
        </div>
        <div
          className="flex flex-1 flex-col min-h-0"
          style={{ display: activeSidebar === SIDEBAR_SOURCE_CONTROL ? "flex" : "none" }}
        >
          <Suspense
            fallback={
              <div className="p-4 text-[var(--color-text-muted)] text-xs">
                {t("workspace.loadingGit")}
              </div>
            }
          >
            <SourceControl />
          </Suspense>
        </div>
        <div
          className="flex flex-1 flex-col min-h-0"
          style={{ display: activeSidebar === SIDEBAR_OUTLINE ? "flex" : "none" }}
        >
          <OutlineView />
        </div>
        <div
          className="flex flex-1 flex-col min-h-0"
          style={{ display: activeSidebar === SIDEBAR_NOTIFICATIONS ? "flex" : "none" }}
        >
          <Suspense
            fallback={
              <div className="p-4 text-[var(--color-text-muted)] text-xs">
                {t("workspace.loadingNotifications")}
              </div>
            }
          >
            <NotificationsPanel />
          </Suspense>
        </div>
        <div
          className="flex flex-1 flex-col min-h-0"
          style={{ display: activeSidebar === SIDEBAR_DEBUG ? "flex" : "none" }}
        >
          <Suspense
            fallback={
              <div className="p-4 text-[var(--color-text-muted)] text-xs">
                {t("workspace.loadingDebug")}
              </div>
            }
          >
            <DebugPanel />
          </Suspense>
        </div>
        <div
          className="flex flex-1 flex-col min-h-0"
          style={{ display: activeSidebar === SIDEBAR_EXTENSIONS ? "flex" : "none" }}
        >
          <ExtensionsPanel />
        </div>
        <div
          className="flex flex-1 flex-col min-h-0"
          style={{
            display:
              activeSidebar !== null && extensionIdFromSidebar(activeSidebar) !== null
                ? "flex"
                : "none",
          }}
        >
          {activeSidebar !== null && extensionIdFromSidebar(activeSidebar) !== null ? (
            <ExtensionSidebar
              key={activeSidebar}
              extensionId={extensionIdFromSidebar(activeSidebar) ?? ""}
            />
          ) : null}
        </div>
      </Card>

      {activeSidebar && (
        <PanelResizeHandle
          orientation="vertical"
          value={sidebarWidth}
          min={200}
          max={520}
          defaultValue={DEFAULT_SIDEBAR_WIDTH}
          label={t("workspace.adjustSidebar")}
          onChange={(width) => setSidebarWidth(clampSidebarWidth(width), false)}
          onCommit={(width) => setSidebarWidth(clampSidebarWidth(width))}
        />
      )}

      {}
      <div ref={editorColumnRef} className="relative flex min-w-0 flex-1 flex-col">
        {}
        <Card className="flex flex-1 flex-col min-w-0 relative overflow-hidden">
          {tabs.length > 0 ? (
            <div className="flex flex-1 flex-col overflow-hidden bg-transparent relative">
              {}
              <EditorTabBar />

              {}
              <div className="relative flex-1 overflow-hidden">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className="absolute inset-0 h-full w-full"
                    style={{
                      visibility: activeTabId === tab.id ? "visible" : "hidden",
                      pointerEvents: activeTabId === tab.id ? "auto" : "none",
                    }}
                  >
                    {renderTabContent(tab, activeTabId, pendingReveal, clearPendingReveal)}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[var(--color-text-muted)] flex-col gap-6 select-none bg-transparent">
              <div className="flex flex-col items-center gap-4 opacity-50 hover:opacity-80 transition-opacity duration-500">
                <img src="/logo.png" alt="Logo" className="w-24 h-24 object-contain" />
              </div>
              <div className="flex flex-col gap-3 text-xs mt-8">
                {[
                  { label: t("fliuno.quickOpenFile"), keys: ["Ctrl", "O"] },
                  { label: t("fliuno.openShortcutLabel"), keys: ["Ctrl", "Shift", "P"] },
                ].map(({ label, keys }) => (
                  <div key={label} className="flex items-center justify-between gap-12">
                    <span>{label}</span>
                    <span className="flex gap-1">
                      {keys.map((k) => (
                        <kbd
                          key={k}
                          className="bg-[var(--material-surface)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {isBottomPanelOpen && (
          <PanelResizeHandle
            orientation="horizontal"
            value={bottomPanelHeight}
            min={140}
            max={600}
            defaultValue={DEFAULT_BOTTOM_PANEL_HEIGHT}
            label={t("workspace.adjustBottomPanel")}
            onChange={(height) => setBottomPanelHeight(clampBottomPanelHeight(height), false)}
            onCommit={(height) => setBottomPanelHeight(clampBottomPanelHeight(height))}
          />
        )}

        {}
        <Card
          className="shrink-0 flex flex-col min-w-0 relative overflow-hidden group border-t-0"
          style={{
            height: isBottomPanelOpen ? `${bottomPanelHeight}px` : 0,
            minHeight: isBottomPanelOpen ? "140px" : 0,
            maxHeight: isBottomPanelOpen ? "min(600px, calc(100% - 160px))" : 0,
            display: isBottomPanelOpen ? "flex" : "none",
          }}
        >
          {}
          <div className="flex items-center px-3 py-1.5 bg-transparent relative z-10 select-none border-t border-[var(--border-subtle)]">
            <div className="flex items-center gap-0.5">
              {(["problems", "output", "terminal", "debug-console", "references"] as const).map(
                (tabId) => {
                  const labels = {
                    problems: t("bottomPanel.problems"),
                    output: t("bottomPanel.output"),
                    terminal: t("bottomPanel.terminal"),
                    "debug-console": t("bottomPanel.debugConsole"),
                    references: t("bottomPanel.references"),
                  };
                  const isActive = activeBottomPanel === tabId;
                  const count = tabId === "problems" && problems.length ? problems.length : null;
                  return (
                    <button
                      type="button"
                      key={tabId}
                      onClick={() => setActiveBottomPanel(tabId)}
                      className={`relative h-[26px] px-2.5 text-[12px] transition-colors duration-150 flex items-center gap-1.5 rounded-lg ${
                        isActive
                          ? "bg-[var(--material-surface)] text-[var(--color-text-highlight)]"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)]"
                      }`}
                    >
                      <span>{labels[tabId]}</span>
                      {count !== null && count > 0 && (
                        <span
                          className={`flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[10px] rounded-full ${
                            isActive
                              ? "bg-[var(--color-accent)] text-white"
                              : "bg-[var(--color-accent)]/20 text-[var(--color-accent)] font-bold"
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                },
              )}
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-0.5">
              {activeBottomPanel === "terminal" && (
                <div className="flex items-center gap-0.5 mr-2 pr-2 relative after:content-[''] after:absolute after:right-0 after:top-1/2 after:-translate-y-1/2 after:w-px after:h-[14px] after:bg-[var(--border-subtle)]">
                  <Tooltip content={t("workspace.terminalList")} delay={300} placement="top">
                    <button
                      type="button"
                      className={`flex h-[26px] w-[26px] items-center justify-center rounded-lg transition-colors ${
                        isTerminalListVisible
                          ? "bg-[var(--material-surface)] text-[var(--color-text-highlight)]"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)]"
                      }`}
                      onClick={() => setIsTerminalListVisible(!isTerminalListVisible)}
                    >
                      <Icons.List size={14} />
                    </button>
                  </Tooltip>
                  <div className="relative">
                    <Tooltip content={t("workspace.clearTerminal")} delay={300} placement="top">
                      <button
                        type="button"
                        className="flex h-[26px] w-[26px] items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)] rounded-lg transition-colors"
                        onClick={() => {
                          if (activeTerminalId) TerminalManager.clearTerminal(activeTerminalId);
                        }}
                      >
                        <Icons.Eraser size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content={t("workspace.newTerminal")} delay={300} placement="top">
                      <button
                        type="button"
                        className="flex h-[26px] w-[26px] items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] hover:bg-[var(--material-interactive-hover)] rounded-lg transition-colors"
                        onClick={() => TerminalManager.createTerminal()}
                      >
                        <Icons.Plus size={14} />
                      </button>
                    </Tooltip>
                    <DropdownMenuRoot
                      open={isShellDropdownOpen}
                      onOpenChange={setIsShellDropdownOpen}
                    >
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
                            label={shell.name}
                            onSelect={() => {
                              TerminalManager.createTerminal(shell.id);
                              setIsShellDropdownOpen(false);
                            }}
                          />
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

          {}
          <div className="flex-1 relative overflow-hidden bg-transparent border-t border-[var(--border-subtle)] flex">
            <div
              className="flex-1 relative"
              style={{ display: activeBottomPanel === "terminal" ? "block" : "none" }}
            >
              {terminalStartupError && terminals.length === 0 && (
                <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
                  <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-[var(--border-overlay)] bg-[var(--material-overlay)] p-5 text-center backdrop-blur-[var(--glass-blur-floating)]">
                    <Icons.AlertTriangle size={20} className="text-[var(--StatusWarning)]" />
                    <div className="text-[13px] font-medium text-[var(--color-text-highlight)]">
                      终端启动失败
                    </div>
                    <div className="text-[11px] text-[var(--color-text-muted)]">
                      {terminalStartupError}
                    </div>
                    <Button variant="glass" onClick={() => void ensureTerminal()}>
                      重试
                    </Button>
                  </div>
                </div>
              )}
              {terminals.map((term) => (
                <div
                  key={term.id}
                  className="absolute inset-0 p-2"
                  style={{
                    visibility: activeTerminalId === term.id ? "visible" : "hidden",
                    zIndex: activeTerminalId === term.id ? 1 : 0,
                  }}
                >
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center w-full h-full text-[var(--color-text-muted)] text-xs">
                        加载终端...
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

            {activeBottomPanel === "references" && (
              <div className="absolute inset-0">
                <LocationResultsPanel />
              </div>
            )}

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
                    清空
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
                            `复制失败：${error instanceof Error ? error.message : String(error)}`,
                            "error",
                          ),
                        );
                    }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--material-interactive-hover)]"
                  >
                    <Icons.Copy size={12} />
                    复制
                  </button>
                  <span className="ml-auto text-[10px] opacity-70">
                    {outputChannel.entries.length} 条 · {(outputChannel.bytes / 1024).toFixed(1)}{" "}
                    KiB
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
                      此输出通道暂无内容
                    </div>
                  )}
                </div>
              </div>
            )}
            {activeBottomPanel === "debug-console" && (
              <div className="absolute inset-0 flex flex-col font-mono text-[12px]">
                <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5 text-[var(--color-text-muted)]">
                  <button
                    type="button"
                    onClick={() => OutputService.clear("debug-adapter")}
                    className="rounded-lg px-2 py-1 hover:bg-[var(--material-interactive-hover)]"
                  >
                    清空
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
                            `复制失败：${error instanceof Error ? error.message : String(error)}`,
                            "error",
                          ),
                        );
                    }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--material-interactive-hover)]"
                  >
                    <Icons.Copy size={12} />
                    复制
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
                      启动调试会话后，Adapter 和程序输出会显示在这里
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-1.5">
                  <span className="select-none text-[13px] font-bold text-[var(--color-accent)]">
                    &gt;
                  </span>
                  <input
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
        </Card>
      </div>

      {}
      <Modal
        isOpen={!!pendingCloseTab}
        onClose={() => setPendingCloseTab(null)}
        title={t("workspace.unsavedTitle")}
        icon={<Icons.AlertTriangle className="text-[var(--color-accent)]" size={18} stroke={2} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingCloseTab(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={handleSaveAndClose}>
              {t("workspace.saveAndClose")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingCloseTab) {
                  if (pendingCloseTab.path) void RecoveryCoordinator.discard(pendingCloseTab.path);
                  closeTabById(pendingCloseTab.id);
                }
                setPendingCloseTab(null);
              }}
            >
              {t("workspace.discardChanges")}
            </Button>
          </>
        }
      >
        <strong>
          {pendingCloseTab?.titleKey ? t(pendingCloseTab.titleKey) : pendingCloseTab?.title}
        </strong>{" "}
        {t("workspace.unsavedHint")}
      </Modal>
      <Modal
        isOpen={renameRequest !== null}
        onClose={() => setRenameRequest(null)}
        title={t("language.renameTitle")}
        icon={<Icons.Typography size={18} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameRequest(null)}>
              {t("language.cancel")}
            </Button>
            {renamePreview && renameEdit ? (
              <Button
                variant="primary"
                disabled={renameBusy}
                onClick={async () => {
                  setRenameBusy(true);
                  setRenameError(null);
                  try {
                    await LanguageFeatureService.applyWorkspaceEditWithFingerprints(
                      renameEdit,
                      renamePreview.fingerprints,
                    );
                    setRenameRequest(null);
                  } catch (error) {
                    setRenameError(error instanceof Error ? error.message : String(error));
                  } finally {
                    setRenameBusy(false);
                  }
                }}
              >
                {renameBusy
                  ? t("language.applying")
                  : t("language.applyChanges").replace("{count}", String(renamePreview.totalEdits))}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!renameName.trim() || renameBusy}
                onClick={async () => {
                  if (!renameRequest) return;
                  setRenameBusy(true);
                  setRenameError(null);
                  try {
                    const result = await LanguageFeatureService.previewRename(
                      renameRequest.path,
                      renameRequest.language,
                      renameRequest.line,
                      renameRequest.character,
                      renameName.trim(),
                    );
                    setRenameEdit(result.edit);
                    setRenamePreview(result.preview);
                  } catch (error) {
                    setRenameError(error instanceof Error ? error.message : String(error));
                  } finally {
                    setRenameBusy(false);
                  }
                }}
              >
                {renameBusy ? t("language.checking") : t("language.previewChanges")}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          {!renamePreview && (
            <input
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              placeholder={t("language.renamePlaceholder")}
              className="h-9 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--material-surface)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
          )}
          {renamePreview && <WorkspaceEditPreviewList preview={renamePreview} />}
          {renameError && (
            <div className="text-[12px] text-[var(--StatusError)]">{renameError}</div>
          )}
        </div>
      </Modal>
      <Modal
        isOpen={codeActionLanguage !== null}
        onClose={() => setCodeActionLanguage(null)}
        title={t("language.codeActionsTitle")}
        icon={<Icons.Sparkles size={18} />}
      >
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {codeActionError && (
            <div className="p-3 text-[12px] text-[var(--StatusError)]">{codeActionError}</div>
          )}
          {codeActions?.length === 0 && !codeActionError && (
            <div className="p-6 text-center text-[12px] text-[var(--color-text-muted)]">
              {t("language.noActions")}
            </div>
          )}
          {codeActions?.map((action) => (
            <button
              type="button"
              key={`${action.title}-${action.kind ?? ""}-${action.command?.command ?? JSON.stringify(action.edit ?? {})}`}
              disabled={Boolean(action.disabled)}
              aria-label={
                action.disabled ? `${action.title}：${action.disabled.reason}` : action.title
              }
              onClick={async () => {
                if (!codeActionLanguage) return;
                try {
                  const prepared = await LanguageFeatureService.previewCodeAction(
                    codeActionLanguage,
                    action,
                  );
                  if (prepared) {
                    setCodeActionLanguage(null);
                    setCodeActionPreview(prepared);
                    setCodeActionPreviewError(null);
                  } else {
                    await LanguageFeatureService.applyCodeAction(codeActionLanguage, action);
                    setCodeActionLanguage(null);
                  }
                } catch (error) {
                  setCodeActionError(error instanceof Error ? error.message : String(error));
                }
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-[var(--material-interactive-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span>{action.title}</span>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {action.disabled?.reason ?? action.kind ?? "action"}
              </span>
            </button>
          ))}
        </div>
      </Modal>
      <Modal
        isOpen={codeActionPreview !== null}
        onClose={() => setCodeActionPreview(null)}
        title={t("language.previewTitle")}
        icon={<Icons.Sparkles size={18} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCodeActionPreview(null)}>
              {t("language.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={codeActionPreviewBusy}
              onClick={async () => {
                if (!codeActionPreview) return;
                setCodeActionPreviewBusy(true);
                setCodeActionPreviewError(null);
                try {
                  await LanguageFeatureService.applyWorkspaceEditWithFingerprints(
                    codeActionPreview.edit,
                    codeActionPreview.preview.fingerprints,
                  );
                  setCodeActionPreview(null);
                } catch (error) {
                  setCodeActionPreviewError(error instanceof Error ? error.message : String(error));
                } finally {
                  setCodeActionPreviewBusy(false);
                }
              }}
            >
              {codeActionPreviewBusy
                ? t("language.applying")
                : t("language.applyChanges").replace(
                    "{count}",
                    String(codeActionPreview?.preview.totalEdits ?? 0),
                  )}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {codeActionPreview && <WorkspaceEditPreviewList preview={codeActionPreview.preview} />}
          {codeActionPreviewError && (
            <div className="text-[12px] text-[var(--StatusError)]">{codeActionPreviewError}</div>
          )}
        </div>
      </Modal>
      <Modal
        isOpen={symbolSearch !== null}
        onClose={() => setSymbolSearch(null)}
        title={t("language.symbolSearchTitle")}
        icon={<Icons.Sparkles size={18} />}
      >
        <div className="space-y-3">
          <input
            ref={symbolInputRef}
            value={symbolQuery}
            onChange={(event) => {
              setSymbolQuery(event.target.value);
              setSymbolIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSymbolIndex((index) =>
                  Math.min(index + 1, Math.max(0, filteredSymbols.length - 1)),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSymbolIndex((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const symbol = filteredSymbols[symbolIndex];
                if (symbol && symbolSearch) {
                  openFile(symbolSearch.path);
                  requestReveal(symbolSearch.path, symbol.line);
                  setSymbolSearch(null);
                }
              }
            }}
            placeholder={t("language.symbolSearchPlaceholder")}
            className="h-9 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--material-surface)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
          {symbolError && (
            <div className="text-[12px] text-[var(--StatusError)]">{symbolError}</div>
          )}
          {filteredSymbols.length === 0 && !symbolError && (
            <div className="p-6 text-center text-[12px] text-[var(--color-text-muted)]">
              {t("language.noSymbols")}
            </div>
          )}
          <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl bg-[var(--material-surface)] p-1.5 aurona-scroll">
            {filteredSymbols.map((symbol, index) => (
              <button
                type="button"
                key={`${symbol.line}-${symbol.depth}-${symbol.name}`}
                onClick={() => {
                  if (!symbolSearch) return;
                  openFile(symbolSearch.path);
                  requestReveal(symbolSearch.path, symbol.line);
                  setSymbolSearch(null);
                }}
                onMouseMove={() => setSymbolIndex(index)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] transition-colors ${
                  index === symbolIndex
                    ? "bg-[var(--material-interactive-active)]"
                    : "hover:bg-[var(--material-interactive-hover)]"
                }`}
                style={{ paddingLeft: `${8 + symbol.depth * 14}px` }}
              >
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-highlight)]">
                  {symbol.name}
                </span>
                {symbol.detail && (
                  <span className="truncate text-[10px] text-[var(--color-text-muted)]">
                    {symbol.detail}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {symbol.line}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={trustRequest !== null}
        onClose={() => setTrustRequest(null)}
        title={t("workspace.trustTitle")}
        icon={<Icons.AlertTriangle size={18} className="text-[var(--StatusWarning)]" />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTrustRequest(null)}>
              {t("workspace.trustNo")}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!trustRequest) return;
                const request = trustRequest;
                await LanguageConfigurationService.trust(request.root);
                setTrustRequest(null);
                await LspClient.getInstance()
                  .startServer(request.language)
                  .catch(() => undefined);
              }}
            >
              {t("workspace.trustYes")}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-[13px] leading-relaxed text-[var(--color-text-primary)]">
          <p>{t("workspace.trustBody")}</p>
          <p className="rounded-lg bg-[var(--material-surface)] p-2 font-mono text-[11px]">
            {trustRequest?.root}
          </p>
          <p className="text-[12px] text-[var(--color-text-muted)]">{t("workspace.trustHint")}</p>
        </div>
      </Modal>
    </div>
  );
}
