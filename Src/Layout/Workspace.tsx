import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { RecoveryCoordinator } from "../Core/Recovery/RecoveryCoordinator";
import { CommandRegistry } from "../Extension/CommandRegistry";
import { EditorTabBar } from "../Features/Editor/EditorTabBar";
import { ExtensionSidebar } from "../Features/Extensions/ExtensionSidebar";
import { ExtensionsPanel } from "../Features/Extensions/ExtensionsPanel";
import { FliunoWorkspacePage } from "../Features/Fliuno/FliunoWorkspacePage";
import { OutlineView } from "../Features/Language/OutlineView";
import { AboutTab } from "../Features/Settings/AboutTab";
import { ChangelogTab } from "../Features/Settings/ChangelogTab";
import { PerformanceBenchmarkPage } from "../Features/Settings/PerformanceBenchmarkPage";
import { SettingsTab } from "../Features/Settings/SettingsTab";
import { LanguageModals } from "../Features/Workspace/Components/LanguageModals";
import { WorkspaceBottomPanel } from "../Features/Workspace/Components/WorkspaceBottomPanel";
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
import {
  DEFAULT_BOTTOM_PANEL_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  useWorkbenchStore,
} from "../State/useWorkspaceStore";
import { Button } from "../UI/Components/Button";
import { Card } from "../UI/Components/Card";
import { Modal } from "../UI/Components/Modal";
import { PanelResizeHandle } from "../UI/Components/PanelResizeHandle";
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
const DebugPanel = lazy(() =>
  import("../Features/Debug/DebugPanel").then((m) => ({ default: m.DebugPanel })),
);
const DiffViewer = lazy(() =>
  import("../Features/SourceControl/DiffViewer").then((m) => ({ default: m.DiffViewer })),
);
const MarketplaceDetailPage = lazy(() =>
  import("../Features/Extensions/Marketplace/MarketplaceDetailPage").then((m) => ({
    default: m.MarketplaceDetailPage,
  })),
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
    content = <AboutTab />;
  } else if (tab.type === "settings") {
    content = <SettingsTab />;
  } else if (tab.type === "fliuno") {
    content = <FliunoWorkspacePage />;
  } else if (tab.type === "changelog") {
    content = <ChangelogTab />;
  } else if (tab.type === "performance") {
    content = <PerformanceBenchmarkPage />;
  } else if (tab.type === "diff" && tab.path) {
    content = <DiffViewer diffTarget={tab.path} />;
  } else if (tab.type === "extension" && tab.path) {
    content = <MarketplaceDetailPage extensionId={tab.path} />;
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
    bottomPanelHeight,
    pendingCloseTab,
    setPendingCloseTab,
    setSidebarWidth,
    setBottomPanelHeight,
    openFile,
    closeTabById,
    pendingReveal,
    clearPendingReveal,
  } = useWorkbenchStore();

  const [mountedExtensions, setMountedExtensions] = useState<Set<string>>(new Set());
  const currentExtId = activeSidebar ? extensionIdFromSidebar(activeSidebar) : null;

  useEffect(() => {
    if (currentExtId) {
      setMountedExtensions((prev) => {
        if (prev.has(currentExtId)) return prev;
        const next = new Set(prev);
        next.add(currentExtId);
        return next;
      });
    }
  }, [currentExtId]);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const editorColumnRef = useRef<HTMLDivElement>(null);

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

  const handleSaveAndClose = async () => {
    if (pendingCloseTab) {
      if (pendingCloseTab.path) {
        await CommandRegistry.execute("file.save");
      }
      closeTabById(pendingCloseTab.id);
    }
    setPendingCloseTab(null);
  };

  return (
    <div
      ref={workspaceRef}
      className="flex h-full w-full overflow-hidden bg-transparent pb-1 pl-0 pr-[var(--WorkspaceGap)] text-[13px]"
    >
      {/* 侧边栏卡片 */}
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

        {Array.from(mountedExtensions).map((extId) => (
          <div
            key={extId}
            className="flex flex-1 flex-col min-h-0"
            style={{
              display: currentExtId === extId ? "flex" : "none",
            }}
          >
            <ExtensionSidebar extensionId={extId} />
          </div>
        ))}
      </Card>

      {/* 侧边栏拖拽把柄（垂直方向条左右拖拽） */}
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

      {/* 右侧主编辑器与底部面板区域 */}
      <div ref={editorColumnRef} className="relative flex min-w-0 flex-1 flex-col">
        {/* 编辑区主卡片 */}
        <Card className="flex flex-1 flex-col min-w-0 relative overflow-hidden">
          {tabs.length > 0 ? (
            <div className="flex flex-1 flex-col overflow-hidden bg-transparent relative">
              <EditorTabBar />

              <div className="relative flex-1 overflow-hidden">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className="absolute inset-0 h-full w-full isolate"
                    style={{
                      // Keep the React tree mounted so page state survives, but remove
                      // inactive Canvas/WebView layers from composition completely.
                      // `visibility: hidden` keeps those layers alive and can leave a
                      // stale frame visible while the next tab is painted.
                      display: activeTabId === tab.id ? "block" : "none",
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

        {/* 底部面板拖拽把柄（水平方向条上下拖拽） */}
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

        {/* 底部面板卡片 */}
        {isBottomPanelOpen && (
          <Card
            className="shrink-0 flex flex-col min-w-0 relative overflow-hidden group border-t-0"
            style={{
              height: isBottomPanelOpen ? `${bottomPanelHeight}px` : 0,
              minHeight: isBottomPanelOpen ? "140px" : 0,
              maxHeight: isBottomPanelOpen ? "min(600px, calc(100% - 160px))" : 0,
              display: isBottomPanelOpen ? "flex" : "none",
            }}
          >
            <WorkspaceBottomPanel />
          </Card>
        )}
      </div>

      {/* 未保存修改关闭确认弹窗 */}
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

      {/* 语言服务交互弹窗集中挂载点 */}
      <LanguageModals />
    </div>
  );
}
