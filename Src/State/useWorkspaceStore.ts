import { create } from "zustand";
import { FileSystemService } from "../Core/FileSystemService";
import { desktopDialog } from "../Foundation/Desktop/Dialog";
import { EventBus } from "../Foundation/EventBus";
import { PlatformService } from "../Foundation/Platform";
import { WorkspaceStore } from "../Foundation/Storage/WorkspaceStore";
import type { TabItem } from "../Foundation/Types/Tab";
import { SIDEBAR_EXPLORER } from "../Shared/Constants/Sidebar";
import { showToast } from "../UI/Feedback/Toast";

export type BottomPanel = "problems" | "output" | "terminal" | "debug-console";

export const DEFAULT_SIDEBAR_WIDTH = 260;
export const DEFAULT_BOTTOM_PANEL_HEIGHT = 300;

export interface WorkbenchState {
  tabs: TabItem[];
  activeTabId: string | null;
  activeSidebar: string | null;
  sidebarWidth: number;
  isBottomPanelOpen: boolean;
  activeBottomPanel: BottomPanel;
  bottomPanelHeight: number;
  pendingCloseTab: TabItem | null;
  pendingReveal: { path: string; line: number } | null;

  setActiveTabId(id: string | null): void;
  setActiveSidebar(id: string | null): void;
  setSidebarWidth(width: number, persist?: boolean): void;
  setBottomPanelOpen(open: boolean): void;
  toggleBottomPanel(force?: boolean): void;
  setActiveBottomPanel(panel: BottomPanel): void;
  setBottomPanelHeight(height: number, persist?: boolean): void;
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

export const filePathIdentity = (path: string) => {
  const normalized = path
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "")
    .normalize("NFC");
  return PlatformService.current() === "windows"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
};

const findOpenFileTab = (tabs: TabItem[], path: string) => {
  const identity = filePathIdentity(path);
  return tabs.find(
    (tab) => tab.type === "file" && tab.path && filePathIdentity(tab.path) === identity,
  );
};

const deduplicateFileTabs = (tabs: TabItem[]) => {
  const identities = new Set<string>();
  return tabs.filter((tab) => {
    if (tab.type !== "file" || !tab.path) return true;
    const identity = filePathIdentity(tab.path);
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
};

const persistWorkbench = (state: WorkbenchState) => {
  void WorkspaceStore.set({
    openTabs: state.tabs,
    activeTabId: state.activeTabId,
    activeSidebar: state.activeSidebar,
    sidebarWidth: state.sidebarWidth,
    isBottomPanelOpen: state.isBottomPanelOpen,
    activeBottomPanel: state.activeBottomPanel,
    bottomPanelHeight: state.bottomPanelHeight,
  });
};

const normalizeSize = (value: number | undefined, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), min), max)
    : fallback;

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  activeSidebar: SIDEBAR_EXPLORER,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  isBottomPanelOpen: false,
  activeBottomPanel: "problems",
  bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
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
  setSidebarWidth: (width, persist = true) => {
    set({ sidebarWidth: normalizeSize(width, DEFAULT_SIDEBAR_WIDTH, 180, 640) });
    if (persist) persistWorkbench(get());
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
  setBottomPanelHeight: (height, persist = true) => {
    set({
      bottomPanelHeight: normalizeSize(height, DEFAULT_BOTTOM_PANEL_HEIGHT, 120, 720),
    });
    if (persist) persistWorkbench(get());
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
    set((state) => {
      const existing = findOpenFileTab(state.tabs, path);
      return existing
        ? { tabs: state.tabs, activeTabId: existing.id }
        : {
            tabs: [...state.tabs, { id: path, type: "file", title, path, isDirty: false }],
            activeTabId: path,
          };
    });
    persistWorkbench(get());
  },
  openTab: (tab) => {
    if (!tab?.id || !tab.type || !tab.title) return;
    if (tab.type === "file" && tab.path) {
      get().openFile(tab.path);
      return;
    }
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
  const savedTabs = saved.openTabs ?? [];
  const tabs = deduplicateFileTabs(savedTabs);
  const savedActiveTab = savedTabs.find((tab) => tab.id === saved.activeTabId);
  const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId)
    ? (saved.activeTabId ?? null)
    : savedActiveTab?.path
      ? (findOpenFileTab(tabs, savedActiveTab.path)?.id ?? tabs.at(-1)?.id ?? null)
      : (tabs.at(-1)?.id ?? null);
  useWorkbenchStore.setState({
    tabs,
    activeTabId,
    activeSidebar: saved.activeSidebar ?? SIDEBAR_EXPLORER,
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
