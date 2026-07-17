import { create } from "zustand";
import { FileSystemService } from "../Core/FileSystemService";
import { desktopDialog } from "../Foundation/Desktop";
import { EventBus } from "../Foundation/EventBus";
import { WorkspaceStore } from "../Foundation/Storage/WorkspaceStore";
import type { TabItem } from "../Foundation/Types/Tab";
import { SIDEBAR_EXPLORER } from "../Shared/Constants/Sidebar";
import { showToast } from "../UI/Feedback/Toast";

export type BottomPanel = "problems" | "output" | "terminal";

export interface WorkbenchState {
  tabs: TabItem[];
  activeTabId: string | null;
  activeSidebar: string | null;
  isBottomPanelOpen: boolean;
  activeBottomPanel: BottomPanel;
  pendingCloseTab: TabItem | null;
  pendingReveal: { path: string; line: number } | null;

  setActiveTabId(id: string | null): void;
  setActiveSidebar(id: string | null): void;
  setBottomPanelOpen(open: boolean): void;
  toggleBottomPanel(force?: boolean): void;
  setActiveBottomPanel(panel: BottomPanel): void;
  setPendingCloseTab(tab: TabItem | null): void;
  requestReveal(path: string, line: number): void;
  clearPendingReveal(path: string, line: number): void;
  openFile(path: string): void;
  openTab(tab: TabItem): void;
  closeTab(tab: TabItem): void;
  closeTabById(id: string): void;
  updateTabs(updater: (tabs: TabItem[]) => TabItem[]): void;
}

const isPathInside = (path: string, directory: string) =>
  path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`);

const persistWorkbench = (state: WorkbenchState) => {
  void WorkspaceStore.set({
    openTabs: state.tabs,
    activeTabId: state.activeTabId,
    activeSidebar: state.activeSidebar,
    isBottomPanelOpen: state.isBottomPanelOpen,
    activeBottomPanel: state.activeBottomPanel,
  });
};

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  activeSidebar: SIDEBAR_EXPLORER,
  isBottomPanelOpen: false,
  activeBottomPanel: "problems",
  pendingCloseTab: null,
  pendingReveal: null,

  setActiveTabId: (id) => {
    set({ activeTabId: id });
    persistWorkbench(get());
  },
  setActiveSidebar: (id) => {
    set({ activeSidebar: id });
    persistWorkbench(get());
  },
  setBottomPanelOpen: (open) => {
    set({ isBottomPanelOpen: open });
    persistWorkbench(get());
  },
  toggleBottomPanel: (force) => {
    set((state) => ({
      isBottomPanelOpen: force ?? !state.isBottomPanelOpen,
      activeBottomPanel: force === true ? "terminal" : state.activeBottomPanel,
    }));
    persistWorkbench(get());
  },
  setActiveBottomPanel: (panel) => {
    set({ activeBottomPanel: panel, isBottomPanelOpen: true });
    persistWorkbench(get());
  },
  setPendingCloseTab: (tab) => set({ pendingCloseTab: tab }),
  requestReveal: (path, line) => set({ pendingReveal: { path, line } }),
  clearPendingReveal: (path, line) =>
    set((state) =>
      state.pendingReveal?.path === path && state.pendingReveal.line === line
        ? { pendingReveal: null }
        : state,
    ),
  updateTabs: (updater) => {
    set((state) => ({ tabs: updater(state.tabs) }));
    persistWorkbench(get());
  },
  closeTabById: (id) => {
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const activeTabId = state.activeTabId === id ? (tabs.at(-1)?.id ?? null) : state.activeTabId;
      return { tabs, activeTabId };
    });
    persistWorkbench(get());
  },
  openFile: (path) => {
    const title = FileSystemService.basename(path) || "未知文件";
    set((state) => ({
      tabs: state.tabs.some((tab) => tab.id === path)
        ? state.tabs
        : [...state.tabs, { id: path, type: "file", title, path, isDirty: false }],
      activeTabId: path,
    }));
    persistWorkbench(get());
  },
  openTab: (tab) => {
    if (!tab?.id || !tab.type || !tab.title) return;
    set((state) => ({
      tabs: state.tabs.some((item) => item.id === tab.id) ? state.tabs : [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    persistWorkbench(get());
  },
  closeTab: (tab) => {
    if (tab.isDirty) {
      set({ pendingCloseTab: tab });
      return;
    }
    get().closeTabById(tab.id);
  },
}));

export async function initializeWorkbenchStore(): Promise<() => void> {
  await WorkspaceStore.init();
  const saved = await WorkspaceStore.get();
  useWorkbenchStore.setState({
    tabs: saved.openTabs ?? [],
    activeTabId: saved.activeTabId ?? null,
    activeSidebar: saved.activeSidebar ?? SIDEBAR_EXPLORER,
    isBottomPanelOpen: saved.isBottomPanelOpen ?? false,
    activeBottomPanel: saved.activeBottomPanel ?? "problems",
  });

  const subscriptions = [
    EventBus.on("app:open-file", async () => {
      try {
        const selected = await desktopDialog.openFile();
        if (selected) useWorkbenchStore.getState().openFile(selected);
      } catch (error) {
        showToast(`打开文件失败：${FileSystemService.toMessage(error)}`, "error");
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
        store.setPendingCloseTab(null);
      }
    }),
  ];
  return () => {
    for (const unsubscribe of subscriptions) unsubscribe();
  };
}
