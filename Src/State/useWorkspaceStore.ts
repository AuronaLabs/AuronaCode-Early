import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { FileSystemService } from "../Core/FileSystemService";
import { EventBus } from "../Foundation/EventBus";
import { WorkspaceStore } from "../Foundation/Storage/WorkspaceStore";
import type { TabItem } from "../Foundation/Types/Tab";
import { SIDEBAR_EXPLORER } from "../Shared/Constants/Sidebar";
import { showToast } from "../UI/Feedback/Toast";

export interface WorkspaceState {
  tabs: TabItem[];
  activeTabId: string | null;
  activeSidebar: string | null;
  pendingCloseTab: TabItem | null;
  pendingReveal: { path: string; line: number } | null;

  setActiveTabId: (id: string | null) => void;
  setActiveSidebar: (id: string | null) => void;
  setPendingCloseTab: (tab: TabItem | null) => void;
  requestReveal: (path: string, line: number) => void;
  clearPendingReveal: (path: string, line: number) => void;

  openFile: (path: string) => void;
  openTab: (tab: TabItem) => void;
  closeTab: (tab: TabItem) => void;
  closeTabById: (id: string) => void;

  _setTabs: (updater: (prev: TabItem[]) => TabItem[]) => void;
  _initHydration: () => Promise<void>;
}

const isPathInside = (path: string, directory: string) =>
  path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`);

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  activeSidebar: SIDEBAR_EXPLORER,
  pendingCloseTab: null,
  pendingReveal: null,

  setActiveTabId: (id) => {
    set({ activeTabId: id });
    const { tabs } = get();
    const activeTab = tabs.find((t) => t.id === id);
    EventBus.emit(
      "app:active-file-changed",
      activeTab?.type === "file" ? (activeTab.path ?? null) : null,
    );
    WorkspaceStore.set({ openTabs: tabs, activeTabId: id });
  },

  setActiveSidebar: (id) => set({ activeSidebar: id }),
  setPendingCloseTab: (tab) => set({ pendingCloseTab: tab }),
  requestReveal: (path, line) => set({ pendingReveal: { path, line } }),
  clearPendingReveal: (path, line) =>
    set((state) =>
      state.pendingReveal?.path === path && state.pendingReveal.line === line
        ? { pendingReveal: null }
        : state,
    ),

  _setTabs: (updater) => {
    set((state) => {
      const newTabs = updater(state.tabs);
      WorkspaceStore.set({ openTabs: newTabs, activeTabId: state.activeTabId });
      return { tabs: newTabs };
    });
  },

  closeTabById: (id: string) => {
    set((state) => {
      const newTabs = state.tabs.filter((tab) => tab.id !== id);
      let newActiveTabId = state.activeTabId;
      if (newActiveTabId === id) {
        newActiveTabId = newTabs[newTabs.length - 1]?.id ?? null;
      }
      WorkspaceStore.set({ openTabs: newTabs, activeTabId: newActiveTabId });

      if (state.activeTabId !== newActiveTabId) {
        const activeTab = newTabs.find((t) => t.id === newActiveTabId);
        EventBus.emit(
          "app:active-file-changed",
          activeTab?.type === "file" ? (activeTab.path ?? null) : null,
        );
      }

      return { tabs: newTabs, activeTabId: newActiveTabId };
    });
  },

  openFile: (path: string) => {
    const fileName = FileSystemService.basename(path) || "未知文件";
    set((state) => {
      const existing = state.tabs.find((tab) => tab.id === path);
      const newTabs = existing
        ? state.tabs
        : [
            ...state.tabs,
            { id: path, type: "file" as const, title: fileName, path, isDirty: false },
          ];
      WorkspaceStore.set({ openTabs: newTabs, activeTabId: path });

      EventBus.emit("app:active-file-changed", path);

      return { tabs: newTabs, activeTabId: path };
    });
  },

  openTab: (tab: TabItem) => {
    if (!tab?.id || !tab.type || !tab.title) return;
    set((state) => {
      const existing = state.tabs.find((t) => t.id === tab.id);
      const newTabs = existing ? state.tabs : [...state.tabs, tab];
      WorkspaceStore.set({ openTabs: newTabs, activeTabId: tab.id });

      EventBus.emit("app:active-file-changed", tab.type === "file" ? (tab.path ?? null) : null);

      return { tabs: newTabs, activeTabId: tab.id };
    });
  },

  closeTab: (tab: TabItem) => {
    if (tab.isDirty) {
      get().setPendingCloseTab(tab);
      return;
    }
    get().closeTabById(tab.id);
  },

  _initHydration: async () => {
    await WorkspaceStore.init();
    const config = await WorkspaceStore.get();
    if (config.openTabs && config.openTabs.length > 0) {
      set({ tabs: config.openTabs });
      if (config.activeTabId) {
        get().setActiveTabId(config.activeTabId);
      }
    }
  },
}));

useWorkspaceStore.getState()._initHydration();

EventBus.on("app:open-file", async () => {
  try {
    const selected = await open({ directory: false, multiple: false });
    if (selected && typeof selected === "string") {
      useWorkspaceStore.getState().openFile(selected);
    }
  } catch (error) {
    showToast(`打开文件失败：${FileSystemService.toMessage(error)}`, "error");
  }
});

EventBus.on("app:open-tab", (tab: TabItem) => {
  useWorkspaceStore.getState().openTab(tab);
});

EventBus.on("app:activity-changed", (id: string | null) => {
  useWorkspaceStore.getState().setActiveSidebar(id);
});

EventBus.on("editor:dirty-set", ({ path }: { path: string }) => {
  useWorkspaceStore
    .getState()
    ._setTabs((prev) => prev.map((tab) => (tab.path === path ? { ...tab, isDirty: true } : tab)));
});

EventBus.on("editor:dirty-cleared", ({ path }: { path: string }) => {
  useWorkspaceStore
    .getState()
    ._setTabs((prev) => prev.map((tab) => (tab.path === path ? { ...tab, isDirty: false } : tab)));
});

EventBus.on("file:renamed", (payload: { oldPath: string; newPath: string }) => {
  const store = useWorkspaceStore.getState();
  store._setTabs((prev) =>
    prev.map((tab) => {
      if (!tab.path) return tab;
      if (tab.path === payload.oldPath) {
        return {
          ...tab,
          id: payload.newPath,
          path: payload.newPath,
          title: FileSystemService.basename(payload.newPath),
        };
      }
      if (isPathInside(tab.path, payload.oldPath)) {
        const newChildPath = tab.path.replace(payload.oldPath, payload.newPath);
        return {
          ...tab,
          id: newChildPath,
          path: newChildPath,
          title: FileSystemService.basename(newChildPath),
        };
      }
      return tab;
    }),
  );

  const { activeTabId } = store;
  if (activeTabId) {
    if (activeTabId === payload.oldPath) {
      store.setActiveTabId(payload.newPath);
    } else if (isPathInside(activeTabId, payload.oldPath)) {
      store.setActiveTabId(activeTabId.replace(payload.oldPath, payload.newPath));
    }
  }
});

EventBus.on("file:deleted", (payload: { path: string; isDirectory: boolean }) => {
  const store = useWorkspaceStore.getState();
  const remainingTabs = store.tabs.filter((tab) => {
    if (!tab.path) return true;
    if (tab.path === payload.path) return false;
    return !(payload.isDirectory && isPathInside(tab.path, payload.path));
  });
  store._setTabs(() => remainingTabs);

  const { activeTabId } = useWorkspaceStore.getState();
  if (activeTabId && !remainingTabs.some((tab) => tab.id === activeTabId)) {
    useWorkspaceStore.getState().setActiveTabId(remainingTabs[remainingTabs.length - 1]?.id ?? null);
  }
});

EventBus.on("editor:file-saved", (payload: { path: string }) => {
  const store = useWorkspaceStore.getState();
  if (store.pendingCloseTab && store.pendingCloseTab.path === payload.path) {
    store.closeTabById(store.pendingCloseTab.id);
    store.setPendingCloseTab(null);
  }
});
