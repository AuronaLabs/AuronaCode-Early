import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { TerminalManager } from "../Core/TerminalService";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { EditorTabBar } from "../Features/Editor/EditorTabBar";
import { RecoveryCoordinator } from "../Features/Editor/Model/RecoveryCoordinator";
import { AboutTab } from "../Features/Settings/AboutTab";
import { ChangelogTab } from "../Features/Settings/ChangelogTab";
import { PerformanceBenchmarkPage } from "../Features/Settings/PerformanceBenchmarkPage";
import { SettingsTab } from "../Features/Settings/SettingsTab";
import type { TabItem } from "../Foundation/Types/Tab";
import {
  SIDEBAR_EXPLORER,
  SIDEBAR_NOTIFICATIONS,
  SIDEBAR_PLUGINS,
  SIDEBAR_SEARCH,
  SIDEBAR_SOURCE_CONTROL,
} from "../Shared/Constants/Sidebar";
import { useEditorStore } from "../State/useEditorStore";
import { useTerminalStore } from "../State/useTerminalStore";
import { useWorkbenchStore } from "../State/useWorkspaceStore";
import { Button } from "../UI/Components/Button";
import { Card } from "../UI/Components/Card";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "../UI/Components/DropdownMenu";
import { Modal } from "../UI/Components/Modal";
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
const PluginsPanel = lazy(() =>
  import("../Features/Plugins/PluginsPanel").then((m) => ({ default: m.PluginsPanel })),
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
    // For diff, tab.path stores the commit hash
    content = isActive ? <DiffViewer commitHash={tab.path} /> : null;
  }
  return <Suspense fallback={<div className="w-full h-full bg-transparent" />}>{content}</Suspense>;
}

export function WorkspaceView() {
  const {
    tabs,
    activeTabId,
    activeSidebar,
    isBottomPanelOpen,
    activeBottomPanel,
    pendingCloseTab,
    setActiveTabId,
    setPendingCloseTab,
    setBottomPanelOpen,
    setActiveBottomPanel,
    openFile,
    closeTabById,
    pendingReveal,
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

  const { editorStatus } = useEditorStore();
  const [terminalStartupError, setTerminalStartupError] = useState<string | null>(null);

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

  return (
    <div className="flex h-full w-full overflow-hidden text-[13px] bg-transparent pr-[var(--WorkspaceGap)] pb-1 pl-0 gap-[var(--WorkspaceGap)]">
      {}
      <Card
        className="flex w-[var(--SidebarWidth)] flex-col shrink-0 z-10"
        style={{ display: activeSidebar ? "flex" : "none" }}
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
          style={{ display: activeSidebar === SIDEBAR_PLUGINS ? "flex" : "none" }}
        >
          <Suspense
            fallback={<div className="p-4 text-[var(--TextMuted)] text-xs">Loading Plugins...</div>}
          >
            <PluginsPanel />
          </Suspense>
        </div>
      </Card>

      {}
      <div className="flex flex-1 flex-col min-w-0 gap-[var(--WorkspaceGap)] relative">
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

        {}
        <Card
          className="shrink-0 flex flex-col min-w-0 relative overflow-hidden group border-t-0"
          style={{
            height: isBottomPanelOpen ? "300px" : 0,
            display: isBottomPanelOpen ? "flex" : "none",
          }}
        >
          {}
          <div className="flex items-center px-3 py-1.5 bg-transparent relative z-10 select-none border-t border-[var(--GlassBorder)]">
            <div className="flex items-center gap-0.5">
              {(["problems", "output", "terminal"] as const).map((tabId) => {
                const labels = { problems: "问题", output: "输出", terminal: "终端" };
                const isActive = activeBottomPanel === tabId;
                const count =
                  tabId === "problems" && editorStatus.markers?.length
                    ? editorStatus.markers.length
                    : null;
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
                {editorStatus.markers && editorStatus.markers.length > 0 ? (
                  editorStatus.markers.map((marker) => (
                    <div
                      key={`${marker.source ?? "aurona"}-${marker.line}-${marker.column}-${marker.message}`}
                      className="flex gap-2 items-start text-left hover:bg-[var(--GlassHover)] w-full p-2 rounded-lg cursor-pointer selectable transition-colors"
                    >
                      <div
                        className={`mt-0.5 shrink-0 flex items-center justify-center p-0.5 rounded ${
                          marker.severity === "error"
                            ? "bg-red-500/10 text-red-500"
                            : "bg-orange-500/10 text-orange-500"
                        }`}
                      >
                        <Icons.AlertTriangle size={14} stroke={2} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[13px] font-medium text-[var(--TextHighlight)] whitespace-pre-wrap">
                          {marker.message}
                        </span>
                        <span className="text-[11px] text-[var(--TextMuted)] mt-0.5 font-mono">
                          [{marker.source || "aurona"}] Ln {marker.line}, Col {marker.column}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center w-full h-full gap-2 opacity-50">
                    <Icons.Checks size={32} stroke={1} />
                    <span className="text-[13px]">没有在工作区中检测到任何问题</span>
                  </div>
                )}
              </div>
            )}

            {activeBottomPanel === "output" && (
              <div className="absolute inset-0 p-3 font-mono text-[13px] text-[var(--TextMuted)] overflow-y-auto no-scrollbar">
                {}
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
    </div>
  );
}
