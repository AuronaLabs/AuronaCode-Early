import { useCallback, useContext, useEffect, useRef, useState, createContext, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { EventBus } from "../Core/EventBus";
import { StorageManager } from "../Core/StorageManager";
import { FileSystemService } from "../Core/FileSystemService";
import { showToast } from "../UI/Feedback/Toast";
import type { TabItem } from "../Foundation/Types/Tab";
import type { ReactNode } from "react";
import { SIDEBAR_EXPLORER } from "../Shared/Constants/Sidebar";

export interface WorkspaceContextValue {
  tabs: TabItem[];
  activeTabId: string | null;
  activeSidebar: string | null;
  pendingCloseTab: TabItem | null;
  setActiveTabId: (id: string) => void;
  setActiveSidebar: (id: string | null) => void;
  setPendingCloseTab: (tab: TabItem | null) => void;
  openFile: (path: string) => void;
  openTab: (tab: TabItem) => void;
  // closeTab 不再依赖 React.MouseEvent，调用方自行处理 stopPropagation
  closeTab: (tab: TabItem) => void;
  closeTabById: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const isPathInside = (path: string, directory: string) =>
  path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeSidebar, setActiveSidebar] = useState<string | null>(SIDEBAR_EXPLORER);
  const [pendingCloseTab, setPendingCloseTab] = useState<TabItem | null>(null);
  // 记录「保存后关闭」的 tab ID，用 ref 避免 setState 内嵌 setState 的反模式
  const closeAfterSaveTabIdRef = useRef<string | null>(null);
  // hydration flag：避免首次从存储恢复后立即触发写回
  const isHydratedRef = useRef(false);

  // 恢复上次打开的标签页
  useEffect(() => {
    const initTabs = async () => {
      await StorageManager.init();
      const config = await StorageManager.getConfig();
      if (config.openTabs && config.openTabs.length > 0) {
        setTabs(config.openTabs);
        if (config.activeTabId) setActiveTabId(config.activeTabId);
      }
      isHydratedRef.current = true;
    };
    initTabs();
  }, []);

  // 持久化标签页状态（跳过 hydration 初次触发）
  useEffect(() => {
    if (!isHydratedRef.current) return;
    StorageManager.saveConfig({ openTabs: tabs, activeTabId });
  }, [tabs, activeTabId]);

  // 活跃文件广播
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    EventBus.emit(
      "app:active-file-changed",
      activeTab?.type === "file" ? activeTab.path ?? null : null
    );
  }, [activeTabId, tabs]);

  const closeTabById = useCallback((id: string) => {
    setTabs((prev) => {
      const newTabs = prev.filter((tab) => tab.id !== id);
      setActiveTabId((current) => {
        if (current !== id) return current;
        return newTabs[newTabs.length - 1]?.id ?? null;
      });
      return newTabs;
    });
  }, []);

  const openFile = useCallback((path: string) => {
    const fileName = FileSystemService.basename(path) || "未知文件";
    setTabs((prev) => {
      if (prev.find((tab) => tab.id === path)) return prev;
      return [...prev, { id: path, type: "file", title: fileName, path, isDirty: false }];
    });
    setActiveTabId(path);
  }, []);

  const openTab = useCallback((tab: TabItem) => {
    if (!tab?.id || !tab.type || !tab.title) return;
    setTabs((prev) => {
      if (prev.find((t) => t.id === tab.id)) return prev;
      return [...prev, tab];
    });
    setActiveTabId(tab.id);
  }, []);

  // closeTab 不再接受 React.MouseEvent，UI 事件处理由调用方负责
  const closeTab = useCallback(
    (tab: TabItem) => {
      if (tab.isDirty) {
        setPendingCloseTab(tab);
        return;
      }
      closeTabById(tab.id);
    },
    [closeTabById]
  );

  // EventBus 订阅
  useEffect(() => {
    const handleOpenFileEvent = async () => {
      try {
        const selected = await open({ directory: false, multiple: false });
        if (selected && typeof selected === "string") openFile(selected);
      } catch (error) {
        showToast(`打开文件失败：${FileSystemService.toMessage(error)}`, "error");
      }
    };

    const handleDirtyChanged = (path: string, isDirty: boolean) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.path === path ? { ...tab, isDirty } : tab
        )
      );
    };

    const handleFileRenamed = (payload: { oldPath: string; newPath: string }) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (!tab.path) return tab;
          if (tab.path === payload.oldPath)
            return {
              ...tab,
              id: payload.newPath,
              path: payload.newPath,
              title: FileSystemService.basename(payload.newPath),
            };
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
        })
      );
      setActiveTabId((current) => {
        if (!current) return current;
        if (current === payload.oldPath) return payload.newPath;
        if (isPathInside(current, payload.oldPath))
          return current.replace(payload.oldPath, payload.newPath);
        return current;
      });
    };

    const handleFileDeleted = (payload: { path: string; isDirectory: boolean }) => {
      setTabs((prev) => {
        const newTabs = prev.filter((tab) => {
          if (!tab.path) return true;
          if (tab.path === payload.path) return false;
          return !(payload.isDirectory && isPathInside(tab.path, payload.path));
        });
        setActiveTabId((current) => {
          if (current && newTabs.some((tab) => tab.id === current)) return current;
          return newTabs[newTabs.length - 1]?.id ?? null;
        });
        return newTabs;
      });
    };

    // 使用 ref 避免 setState 内嵌 setState 反模式
    const handleFileSaved = (payload: { path: string }) => {
      const tabId = closeAfterSaveTabIdRef.current;
      if (!tabId) return;
      setTabs((currentTabs) => {
        const target = currentTabs.find((tab) => tab.id === tabId);
        if (target?.path === payload.path) {
          closeAfterSaveTabIdRef.current = null;
          closeTabById(tabId);
          setPendingCloseTab(null);
        }
        return currentTabs;
      });
    };

    const unsubOpenFile = EventBus.on("app:open-file", handleOpenFileEvent);
    const unsubOpenTab = EventBus.on("app:open-tab", openTab);
    const unsubActivity = EventBus.on("app:activity-changed", setActiveSidebar);
    const unsubDirtySet = EventBus.on("editor:dirty-set", ({ path }) => handleDirtyChanged(path, true));
    const unsubDirtyCleared = EventBus.on("editor:dirty-cleared", ({ path }) => handleDirtyChanged(path, false));
    const unsubRenamed = EventBus.on("file:renamed", handleFileRenamed);
    const unsubDeleted = EventBus.on("file:deleted", handleFileDeleted);
    const unsubSaved = EventBus.on("editor:file-saved", handleFileSaved);

    return () => {
      unsubOpenFile();
      unsubOpenTab();
      unsubActivity();
      unsubDirtySet();
      unsubDirtyCleared();
      unsubRenamed();
      unsubDeleted();
      unsubSaved();
    };
  }, [closeTabById, openFile, openTab]);

  const value: WorkspaceContextValue = useMemo(() => ({
    tabs,
    activeTabId,
    activeSidebar,
    pendingCloseTab,
    setActiveTabId,
    setActiveSidebar,
    setPendingCloseTab,
    openFile,
    openTab,
    closeTab,
    closeTabById,
  }), [
    tabs,
    activeTabId,
    activeSidebar,
    pendingCloseTab,
    openFile,
    openTab,
    closeTab,
    closeTabById
  ]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
