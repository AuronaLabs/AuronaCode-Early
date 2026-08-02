import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { DiagnosticsService } from "../Core/DiagnosticsService";
import { LanguageConfigurationService } from "../Core/LanguageConfigurationService";
import {
  type LanguageCodeAction,
  LanguageFeatureService,
  type WorkspaceEdit,
  type WorkspaceEditPreview,
} from "../Core/LanguageFeatureService";
import { type OutputChannelId, OutputService } from "../Core/OutputService";
import { TerminalManager } from "../Core/TerminalService";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { EditorTabBar } from "../Features/Editor/EditorTabBar";
import { LspClient } from "../Features/Editor/LspClient";
import { RecoveryCoordinator } from "../Features/Editor/Model/RecoveryCoordinator";
import { AboutTab } from "../Features/Settings/AboutTab";
import { ChangelogTab } from "../Features/Settings/ChangelogTab";
import { PerformanceBenchmarkPage } from "../Features/Settings/PerformanceBenchmarkPage";
import { SettingsTab } from "../Features/Settings/SettingsTab";
import { EventBus } from "../Foundation/EventBus";
import type { TabItem } from "../Foundation/Types/Tab";
import {
  SIDEBAR_DEBUG,
  SIDEBAR_EXPLORER,
  SIDEBAR_NOTIFICATIONS,
  SIDEBAR_SEARCH,
  SIDEBAR_SOURCE_CONTROL,
} from "../Shared/Constants/Sidebar";
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
const SearchPanel = lazy(() =>
  import("../Features/Search/SearchPanel").then((m) => ({ default: m.SearchPanel })),
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

  const problems = activeFilePath
    ? DiagnosticsService.getAll()
        .filter((document) => sameFilePath(fileUriToPath(document.uri), activeFilePath))
        .flatMap((document) =>
          document.diagnostics.map((diagnostic, index) => ({
            ...diagnostic,
            uri: document.uri,
            key: `${document.uri}-${diagnostic.source ?? "aurona"}-${diagnostic.range.start.line}-${diagnostic.range.start.character}-${index}`,
          })),
        )
    : [];
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
              <div className="p-4 text-[var(--TextMuted)] text-xs">Loading Explorer...</div>
            }
          >
            <FileExplorer onFileSelect={openFile} />
          </Suspense>
        </div>
        <div
          className="flex flex-1 flex-col min-h-0"
          style={{ display: activeSidebar === SIDEBAR_SEARCH ? "flex" : "none" }}
        >
          <Suspense
            fallback={<div className="p-4 text-[var(--TextMuted)] text-xs">Loading Search...</div>}
          >
            <SearchPanel />
          </Suspense>
        </div>
        <div
          className="flex flex-1 flex-col min-h-0"
          style={{ display: activeSidebar === SIDEBAR_SOURCE_CONTROL ? "flex" : "none" }}
        >
          <Suspense
            fallback={<div className="p-4 text-[var(--TextMuted)] text-xs">Loading Git...</div>}
          >
            <SourceControl />
          </Suspense>
        </div>
        <div
          className="flex flex-1 flex-col min-h-0"
          style={{ display: activeSidebar === SIDEBAR_NOTIFICATIONS ? "flex" : "none" }}
        >
          <Suspense
            fallback={
              <div className="p-4 text-[var(--TextMuted)] text-xs">Loading Notifications...</div>
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
            fallback={<div className="p-4 text-[var(--TextMuted)] text-xs">Loading Debug...</div>}
          >
            <DebugPanel />
          </Suspense>
        </div>
      </Card>

      {activeSidebar && (
        <PanelResizeHandle
          orientation="vertical"
          value={sidebarWidth}
          min={200}
          max={520}
          defaultValue={DEFAULT_SIDEBAR_WIDTH}
          label="调整侧边栏宽度"
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
            <div className="flex flex-1 items-center justify-center text-[var(--TextMuted)] flex-col gap-6 select-none bg-transparent">
              <div className="flex flex-col items-center gap-4 opacity-50 hover:opacity-80 transition-opacity duration-500">
                <img src="/logo.png" alt="Logo" className="w-24 h-24 object-contain" />
              </div>
              <div className="flex flex-col gap-3 text-xs mt-8">
                {[
                  { label: "快速打开文件", keys: ["Ctrl", "P"] },
                  { label: "全局搜索", keys: ["Ctrl", "Shift", "F"] },
                  { label: "Fliuno 全局搜索", keys: ["Ctrl", "Shift", "P"] },
                ].map(({ label, keys }) => (
                  <div key={label} className="flex items-center justify-between gap-12">
                    <span>{label}</span>
                    <span className="flex gap-1">
                      {keys.map((k) => (
                        <kbd
                          key={k}
                          className="bg-[var(--GlassSurface-Elevated)] px-1.5 py-0.5 rounded border border-black/10 dark:border-white/20"
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
            label="调整底部面板高度"
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
          <div className="flex items-center px-3 py-1.5 bg-transparent relative z-10 select-none border-t border-[var(--GlassBorder)]">
            <div className="flex items-center gap-0.5">
              {(["problems", "output", "terminal", "debug-console"] as const).map((tabId) => {
                const labels = {
                  problems: "问题",
                  output: "输出",
                  terminal: "终端",
                  "debug-console": "调试控制台",
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
                        ? "bg-[var(--GlassSurface-Elevated)] text-[var(--TextHighlight)]"
                        : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)]"
                    }`}
                  >
                    <span>{labels[tabId]}</span>
                    {count !== null && count > 0 && (
                      <span
                        className={`flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[10px] rounded-full ${
                          isActive
                            ? "bg-[var(--AccentPrimary)] text-white"
                            : "bg-[var(--AccentPrimary)]/20 text-[var(--AccentPrimary)] font-bold"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-0.5">
              {activeBottomPanel === "terminal" && (
                <div className="flex items-center gap-0.5 mr-2 pr-2 relative after:content-[''] after:absolute after:right-0 after:top-1/2 after:-translate-y-1/2 after:w-px after:h-[14px] after:bg-[var(--GlassBorder)]">
                  <Tooltip content="列表" delay={300} placement="top">
                    <button
                      type="button"
                      className={`flex h-[26px] w-[26px] items-center justify-center rounded-lg transition-colors ${
                        isTerminalListVisible
                          ? "bg-[var(--GlassSurface-Elevated)] text-[var(--TextHighlight)]"
                          : "text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)]"
                      }`}
                      onClick={() => setIsTerminalListVisible(!isTerminalListVisible)}
                    >
                      <Icons.List size={14} />
                    </button>
                  </Tooltip>
                  <div className="relative">
                    <Tooltip content="清空终端" delay={300} placement="top">
                      <button
                        type="button"
                        className="flex h-[26px] w-[26px] items-center justify-center text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] rounded-lg transition-colors"
                        onClick={() => {
                          if (activeTerminalId) TerminalManager.clearTerminal(activeTerminalId);
                        }}
                      >
                        <Icons.Eraser size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="新建终端" delay={300} placement="top">
                      <button
                        type="button"
                        className="flex h-[26px] w-[26px] items-center justify-center text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] rounded-lg transition-colors"
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
                          className="flex h-[26px] w-[16px] items-center justify-center text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] rounded-lg transition-colors absolute -right-4 top-0"
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

              <Tooltip content="最小化面板" delay={300} placement="top">
                <button
                  type="button"
                  className="flex h-[26px] w-[26px] items-center justify-center text-[var(--TextMuted)] hover:text-[var(--TextHighlight)] hover:bg-[var(--GlassHover)] rounded-lg transition-colors"
                  onClick={() => setBottomPanelOpen(false)}
                >
                  <Icons.Minimize size={14} />
                </button>
              </Tooltip>
            </div>
          </div>

          {}
          <div className="flex-1 relative overflow-hidden bg-transparent border-t border-[var(--GlassBorder)] flex">
            <div
              className="flex-1 relative"
              style={{ display: activeBottomPanel === "terminal" ? "block" : "none" }}
            >
              {terminalStartupError && terminals.length === 0 && (
                <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
                  <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-[var(--border-overlay)] bg-[var(--material-overlay)] p-5 text-center shadow-[var(--shadow-overlay)] backdrop-blur-[var(--glass-blur-floating)]">
                    <Icons.AlertTriangle size={20} className="text-amber-500" />
                    <div className="text-[13px] font-medium text-[var(--TextHighlight)]">
                      终端启动失败
                    </div>
                    <div className="text-[11px] text-[var(--TextMuted)]">
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
                      <div className="flex items-center justify-center w-full h-full text-[var(--TextMuted)] text-xs">
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
              <div className="w-48 shrink-0 bg-transparent border-l border-[var(--GlassBorder)] flex flex-col p-1 gap-0.5 overflow-y-auto no-scrollbar relative z-20">
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
                        ? "bg-[var(--AccentPrimary)]/10 text-[var(--AccentPrimary)]"
                        : "text-[var(--TextMuted)] hover:bg-[var(--GlassHover)] hover:text-[var(--TextHighlight)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                      <Icons.Terminal size={14} className="shrink-0" />
                      {editingTerminalId === term.id ? (
                        <input
                          type="text"
                          value={editingName}
                          className="bg-transparent outline-none w-full text-[12px] text-[var(--TextHighlight)]"
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
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--GlassHover)] rounded transition-all shrink-0 ml-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        TerminalManager.removeTerminal(term.id);
                      }}
                    >
                      <Icons.Trash size={12} className="text-red-500/80 hover:text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {activeBottomPanel === "problems" && (
              <div className="absolute inset-0 p-3 flex flex-col items-start gap-1 overflow-y-auto no-scrollbar">
                {problems.length > 0 ? (
                  problems.map((problem) => {
                    const path = fileUriToPath(problem.uri);
                    return (
                      <button
                        type="button"
                        key={problem.key}
                        onClick={() => {
                          if (!path) return;
                          openFile(path);
                          requestReveal(path, problem.range.start.line + 1);
                        }}
                        className="flex gap-2 items-start text-left hover:bg-[var(--GlassHover)] w-full p-2 rounded-lg cursor-pointer selectable transition-colors"
                      >
                        <div
                          className={`mt-0.5 shrink-0 flex items-center justify-center p-0.5 rounded ${
                            problem.severity === 1
                              ? "bg-red-500/10 text-red-500"
                              : "bg-orange-500/10 text-orange-500"
                          }`}
                        >
                          <Icons.AlertTriangle size={14} stroke={2} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[13px] font-medium text-[var(--TextHighlight)] whitespace-pre-wrap">
                            {problem.message}
                          </span>
                          <span className="text-[11px] text-[var(--TextMuted)] mt-0.5 font-mono">
                            {path ?? problem.uri} · [{problem.source || "aurona"}] Ln{" "}
                            {problem.range.start.line + 1}, Col {problem.range.start.character + 1}
                          </span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center w-full h-full gap-2 opacity-50">
                    <Icons.Checks size={32} stroke={1} />
                    <span className="text-[13px]">
                      {activeFilePath ? "当前文件没有检测到问题" : "打开代码文件以查看问题"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {activeBottomPanel === "output" && (
              <div className="absolute inset-0 flex flex-col font-mono text-[12px] text-[var(--TextMuted)]">
                <div className="flex shrink-0 items-center gap-2 border-b border-[var(--GlassBorder)] px-3 py-1.5">
                  <Select
                    ariaLabel="输出来源"
                    value={activeOutputChannel}
                    onChange={(value) => setActiveOutputChannel(value as OutputChannelId | "all")}
                    options={[
                      { value: "all", label: "全部 Aurona 日志" },
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
                    className="rounded-lg px-2 py-1 hover:bg-[var(--GlassHover)]"
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
                        .then(() => showToast("输出内容已复制", "success"))
                        .catch((error) =>
                          showToast(
                            `复制失败：${error instanceof Error ? error.message : String(error)}`,
                            "error",
                          ),
                        );
                    }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--GlassHover)]"
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
                            ? "text-red-500"
                            : entry.level === "warn"
                              ? "text-amber-500"
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
                <div className="flex shrink-0 items-center gap-2 border-b border-[var(--GlassBorder)] px-3 py-1.5 text-[var(--TextMuted)]">
                  <button
                    type="button"
                    onClick={() => OutputService.clear("debug-adapter")}
                    className="rounded-lg px-2 py-1 hover:bg-[var(--GlassHover)]"
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
                        .then(() => showToast("调试控制台内容已复制", "success"))
                        .catch((error) =>
                          showToast(
                            `复制失败：${error instanceof Error ? error.message : String(error)}`,
                            "error",
                          ),
                        );
                    }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-[var(--GlassHover)]"
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
                            ? "whitespace-pre-wrap text-red-500"
                            : entry.level === "warn"
                              ? "whitespace-pre-wrap text-amber-500"
                              : "whitespace-pre-wrap text-[var(--TextMuted)]"
                        }
                      >
                        {entry.message}
                      </div>
                    ))
                  ) : (
                    <div className="flex h-full select-none items-center justify-center text-[var(--TextMuted)] opacity-60">
                      启动调试会话后，Adapter 和程序输出会显示在这里
                    </div>
                  )}
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
        title="文件尚未保存"
        icon={<Icons.AlertTriangle className="text-[var(--AccentPrimary)]" size={18} stroke={2} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingCloseTab(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleSaveAndClose}>
              保存并关闭
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
              放弃更改
            </Button>
          </>
        }
      >
        <strong>{pendingCloseTab?.title}</strong> 还有未保存的更改关闭后，这些更改会丢失
      </Modal>
      <Modal
        isOpen={renameRequest !== null}
        onClose={() => setRenameRequest(null)}
        title="重命名符号"
        icon={<Icons.Typography size={18} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameRequest(null)}>
              取消
            </Button>
            {renamePreview && renameEdit ? (
              <Button
                variant="primary"
                disabled={renameBusy}
                onClick={async () => {
                  setRenameBusy(true);
                  setRenameError(null);
                  try {
                    await LanguageFeatureService.applyWorkspaceEdit(renameEdit);
                    setRenameRequest(null);
                  } catch (error) {
                    setRenameError(error instanceof Error ? error.message : String(error));
                  } finally {
                    setRenameBusy(false);
                  }
                }}
              >
                {renameBusy ? "正在应用..." : `确认修改 ${renamePreview.totalEdits} 处`}
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
                {renameBusy ? "正在检查..." : "预览修改"}
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
              placeholder="输入新名称"
              className="h-9 w-full rounded-lg border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Elevated)] px-3 text-[13px] text-[var(--TextPrimary)] outline-none focus:border-[var(--AccentPrimary)]"
            />
          )}
          {renamePreview && (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl bg-[var(--GlassSurface-Elevated)] p-2">
              {renamePreview.files.map((file) => (
                <div
                  key={file.uri}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[12px]"
                >
                  <span className="min-w-0 truncate font-mono">{fileUriToPath(file.uri)}</span>
                  <span className="shrink-0 text-[var(--TextMuted)]">{file.editCount} 处修改</span>
                </div>
              ))}
            </div>
          )}
          {renameError && <div className="text-[12px] text-red-500">{renameError}</div>}
        </div>
      </Modal>
      <Modal
        isOpen={codeActionLanguage !== null}
        onClose={() => setCodeActionLanguage(null)}
        title="代码操作"
        icon={<Icons.Sparkles size={18} />}
      >
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {codeActionError && <div className="p-3 text-[12px] text-red-500">{codeActionError}</div>}
          {codeActions?.length === 0 && !codeActionError && (
            <div className="p-6 text-center text-[12px] text-[var(--TextMuted)]">
              当前光标位置没有可用操作
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
                  await LanguageFeatureService.applyCodeAction(codeActionLanguage, action);
                  setCodeActionLanguage(null);
                } catch (error) {
                  setCodeActionError(error instanceof Error ? error.message : String(error));
                }
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-[var(--GlassHover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span>{action.title}</span>
              <span className="text-[10px] text-[var(--TextMuted)]">
                {action.disabled?.reason ?? action.kind ?? "action"}
              </span>
            </button>
          ))}
        </div>
      </Modal>
      <Modal
        isOpen={trustRequest !== null}
        onClose={() => setTrustRequest(null)}
        title="信任工作区语言服务器"
        icon={<Icons.AlertTriangle size={18} className="text-amber-500" />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTrustRequest(null)}>
              不信任
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
              信任并启动
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-[13px] leading-relaxed text-[var(--TextPrimary)]">
          <p>此工作区包含自定义语言服务器配置，启动后会执行本机程序。</p>
          <p className="rounded-lg bg-[var(--GlassSurface-Elevated)] p-2 font-mono text-[11px]">
            {trustRequest?.root}
          </p>
          <p className="text-[12px] text-[var(--TextMuted)]">
            仅在你信任此项目来源时继续。环境变量值不会写入输出日志。
          </p>
        </div>
      </Modal>
    </div>
  );
}

function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file:")) return null;
  try {
    const url = new URL(uri);
    let path = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    if (url.host) path = `//${url.host}${path}`;
    return path.replace(/\//g, "\\");
  } catch {
    return null;
  }
}

function sameFilePath(left: string | null, right: string): boolean {
  if (!left) return false;
  const normalize = (value: string) => {
    const slashed = value.replace(/\\/g, "/");
    return /^[A-Za-z]:\//.test(slashed) || slashed.startsWith("//")
      ? slashed.toLowerCase()
      : slashed;
  };
  return normalize(left) === normalize(right);
}
