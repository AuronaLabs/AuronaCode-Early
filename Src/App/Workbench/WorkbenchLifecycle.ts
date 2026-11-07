import { DiagnosticsService } from "../../Core/DiagnosticsService";
import { FileSystemService } from "../../Core/FileSystemService";
import { EventBus } from "../../Foundation/EventBus";
import { LocaleService } from "../../Foundation/I18n";
import { EditorIPC } from "../../Foundation/IPC/EditorCommands";
import { WorkspaceStore } from "../../Foundation/Storage/WorkspaceStore";
import { LEGACY_SIDEBAR_SEARCH, SIDEBAR_EXPLORER } from "../../Shared/Constants/Sidebar";
import { pathToFileUri } from "../../Shared/Utils/UriUtils";
import {
  BUILTIN_TAB_TITLE_KEYS,
  canonicalizeExtensionContainerId,
  configureWorkbenchEffects,
  DEFAULT_BOTTOM_PANEL_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  deduplicateFileTabs,
  findOpenFileTab,
  isPathInside,
  migrateWorkbenchExtensionTabs,
  normalizeSize,
  useWorkbenchStore,
  type WorkbenchState,
} from "../../State/Workbench/useWorkbenchStore";
import { showToast } from "../../UI/Feedback/Toast";
export async function initializeWorkbenchStore(): Promise<() => void> {
  await WorkspaceStore.init();
  const saved = await WorkspaceStore.get();
  const canonicalSidebar = canonicalizeExtensionContainerId(saved.activeSidebar);
  const migratedSidebar = canonicalSidebar === LEGACY_SIDEBAR_SEARCH ? null : canonicalSidebar;
  const savedTabs = saved.openTabs ?? [];
  const migratedTabs = migrateWorkbenchExtensionTabs(savedTabs);
  const tabs = deduplicateFileTabs(migratedTabs).map((tab) => {
    const titleKey = BUILTIN_TAB_TITLE_KEYS[tab.id];
    if (!titleKey) return tab;
    return { ...tab, titleKey, title: LocaleService.translate(titleKey) };
  });
  const canonicalActiveTabId = canonicalizeExtensionContainerId(saved.activeTabId);
  const savedActiveTab = savedTabs.find((tab) => tab.id === saved.activeTabId);
  const activeTabId = tabs.some((tab) => tab.id === canonicalActiveTabId)
    ? (canonicalActiveTabId ?? null)
    : savedActiveTab?.path
      ? (findOpenFileTab(tabs, savedActiveTab.path)?.id ?? tabs.at(-1)?.id ?? null)
      : (tabs.at(-1)?.id ?? null);
  useWorkbenchStore.setState({
    tabs,
    activeTabId,
    activeSidebar: migratedSidebar ?? SIDEBAR_EXPLORER,
    sidebarWidth: normalizeSize(saved.sidebarWidth, DEFAULT_SIDEBAR_WIDTH, 180, 640),
    isBottomPanelOpen: saved.isBottomPanelOpen ?? false,
    activeBottomPanel: saved.activeBottomPanel ?? "problems",
    bottomPanelHeight: normalizeSize(
      saved.bottomPanelHeight,
      DEFAULT_BOTTOM_PANEL_HEIGHT,
      120,
      720,
    ),
  });

  const didMigrateExtensionState =
    migratedTabs.length !== savedTabs.length ||
    migratedTabs.some((tab, index) => tab !== savedTabs[index]) ||
    canonicalSidebar !== saved.activeSidebar ||
    canonicalActiveTabId !== saved.activeTabId;
  if (didMigrateExtensionState) {
    await WorkspaceStore.set({
      openTabs: tabs,
      activeTabId,
      activeSidebar: migratedSidebar ?? SIDEBAR_EXPLORER,
    });
  }

  const subscriptions = [
    configureWorkbenchEffects({
      persist: (state: WorkbenchState) => {
        void WorkspaceStore.set({
          openTabs: state.tabs,
          activeTabId: state.activeTabId,
          activeSidebar: state.activeSidebar,
          sidebarWidth: state.sidebarWidth,
          isBottomPanelOpen: state.isBottomPanelOpen,
          activeBottomPanel: state.activeBottomPanel,
          bottomPanelHeight: state.bottomPanelHeight,
        }).catch((error) => showToast(String(error), "error"));
      },
      closed: (path: string) => DiagnosticsService.clear(pathToFileUri(path)),
    }),
    EventBus.on("app:open-file", async () => {
      try {
        const snapshot = await EditorIPC.openDialog();
        if (snapshot) useWorkbenchStore.getState().openFile(snapshot.path);
      } catch (error) {
        showToast(
          `${LocaleService.translate("workspace.openFailed")}${FileSystemService.toMessage(error)}`,
          "error",
        );
      }
    }),
    EventBus.on("app:open-tab", (tab) => useWorkbenchStore.getState().openTab(tab)),
    EventBus.on("editor:dirty-set", ({ path }) => {
      useWorkbenchStore
        .getState()
        .updateTabs((tabs) =>
          tabs.map((tab) => (tab.path === path ? { ...tab, isDirty: true } : tab)),
        );
    }),
    EventBus.on("editor:dirty-cleared", ({ path }) => {
      useWorkbenchStore
        .getState()
        .updateTabs((tabs) =>
          tabs.map((tab) => (tab.path === path ? { ...tab, isDirty: false } : tab)),
        );
    }),
    EventBus.on("file:renamed", ({ oldPath, newPath }) => {
      const store = useWorkbenchStore.getState();
      store.updateTabs((tabs) =>
        tabs.map((tab) => {
          if (!tab.path) return tab;
          if (tab.path !== oldPath && !isPathInside(tab.path, oldPath)) return tab;
          const path = tab.path === oldPath ? newPath : tab.path.replace(oldPath, newPath);
          return { ...tab, id: path, path, title: FileSystemService.basename(path) };
        }),
      );
      if (store.activeTabId === oldPath) store.setActiveTabId(newPath);
      else if (store.activeTabId && isPathInside(store.activeTabId, oldPath)) {
        store.setActiveTabId(store.activeTabId.replace(oldPath, newPath));
      }
    }),
    EventBus.on("file:deleted", ({ path, isDirectory }) => {
      const store = useWorkbenchStore.getState();
      const tabs = store.tabs.filter(
        (tab) => !tab.path || (tab.path !== path && !(isDirectory && isPathInside(tab.path, path))),
      );
      store.updateTabs(() => tabs);
      if (store.activeTabId && !tabs.some((tab) => tab.id === store.activeTabId)) {
        store.setActiveTabId(tabs.at(-1)?.id ?? null);
      }
    }),
    EventBus.on("editor:file-saved", ({ path }) => {
      const store = useWorkbenchStore.getState();
      if (store.pendingCloseTab?.path === path) {
        store.closeTabById(store.pendingCloseTab.id);
        store.advancePendingCloseTab();
      }
    }),
    EventBus.on("editor:reveal-location", ({ path, line }) => {
      const store = useWorkbenchStore.getState();
      store.openFile(path);
      store.requestReveal(path, line);
    }),
  ];
  return () => {
    for (const unsubscribe of subscriptions) unsubscribe();
  };
}
