import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileExplorer } from "../Features/Explorer/FileExplorer";
import { Icons } from "../UI/Icons/IconManager";
import { EventBus } from "../Core/EventBus";
import { TabItem } from "../Shared/Types/Tab";
import { Card } from "../UI/Components/Card";
import { EditorTab } from "../Features/Editor/EditorTab";
import { AboutTab } from "../Features/Settings/AboutTab";
import { SettingsTab } from "../Features/Settings/SettingsTab";
import { ChangelogTab } from "../Features/Settings/ChangelogTab";

import { NotificationsPanel } from "../Features/Notifications/NotificationsPanel";
import { SourceControl } from "../Features/SourceControl/SourceControl";
import { TerminalView } from "../Features/Terminal/TerminalView";
import { EditorAdapter } from "../Features/Editor/EditorAdapter";
import { EditorStatus } from "../Features/Editor/IEditorEngine";
import { FileSystemService } from "../Core/FileSystemService";
import { showToast } from "../UI/Feedback/Toast";
import { Tooltip } from "../UI/Feedback/Tooltip";
import { Modal } from "../UI/Components/Modal";
import { Button } from "../UI/Components/Button";
import { TerminalManager, ShellProfile } from "../Core/TerminalService";
import { StorageManager } from "../Core/StorageManager";

const SIDEBAR_EXPLORER = "资源管理器";
const SIDEBAR_SOURCE_CONTROL = "源代码管理";
const SIDEBAR_NOTIFICATIONS = "通知";

const isPathInside = (path: string, directory: string) => {
  return path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`);
};

export function WorkspaceView() {
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeSidebar, setActiveSidebar] = useState<string | null>(SIDEBAR_EXPLORER);
  const [pendingCloseTab, setPendingCloseTab] = useState<TabItem | null>(null);
  const [closeAfterSaveTabId, setCloseAfterSaveTabId] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [activeBottomTab, setActiveBottomTab] = useState<"problems" | "output" | "terminal">("problems");
  const [terminals, setTerminals] = useState(TerminalManager.getTerminals());
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [isTerminalListVisible, setIsTerminalListVisible] = useState(false);
  const [availableShells, setAvailableShells] = useState<ShellProfile[]>([]);
  const [isShellDropdownOpen, setIsShellDropdownOpen] = useState(false);
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editorStatus, setEditorStatus] = useState<EditorStatus>(EditorAdapter.getStatus());

  useEffect(() => {
    TerminalManager.getAvailableShells().then(setAvailableShells);
  }, []);

  useEffect(() => {
    const initTabs = async () => {
      await StorageManager.init();
      const config = await StorageManager.getConfig();
      if (config.openTabs && config.openTabs.length > 0) {
        setTabs(config.openTabs);
        if (config.activeTabId) {
          setActiveTabId(config.activeTabId);
        }
      }
    };
    initTabs();
  }, []);

  useEffect(() => {
    StorageManager.saveConfig({ openTabs: tabs, activeTabId });
  }, [tabs, activeTabId]);

  useEffect(() => {
    const unsubList = EventBus.on("terminal:list-changed", (list: any) => {
      setTerminals([...list]);
      if (list.length === 0) {
        TerminalManager.createTerminal();
      }
    });
    const unsubActive = EventBus.on("terminal:active-changed", (id: string | null) => setActiveTerminalId(id));
    
    // Initial sync
    const initialList = TerminalManager.getTerminals();
    if (initialList.length === 0) {
      TerminalManager.createTerminal();
    } else {
      setTerminals(initialList);
      setActiveTerminalId(TerminalManager.getActiveTerminalId());
    }

    return () => {
      unsubList();
      unsubActive();
    };
  }, []);

  useEffect(() => {
    return EditorAdapter.onStatusChange(setEditorStatus);
  }, []);

  useEffect(() => {
    EventBus.emit("app:terminal-state-changed", isTerminalOpen);
  }, [isTerminalOpen]);

  useEffect(() => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    EventBus.emit("app:active-file-changed", activeTab?.type === "file" ? activeTab.path : null);
  }, [activeTabId, tabs]);

  const handleOpenFileSelect = useCallback((path: string) => {
    const fileName = FileSystemService.basename(path) || "未知文件";

    setTabs((previous) => {
      const existing = previous.find((tab) => tab.id === path);
      if (existing) return previous;
      return [...previous, { id: path, type: "file", title: fileName, path, isDirty: false }];
    });

    setActiveTabId(path);
  }, []);

  const handleOpenFileEvent = useCallback(async () => {
    try {
      const selected = await open({ directory: false, multiple: false });
      if (selected && typeof selected === "string") handleOpenFileSelect(selected);
    } catch (error) {
      showToast(`打开文件失败：${FileSystemService.toMessage(error)}`, "error");
    }
  }, [handleOpenFileSelect]);

  const handleOpenTabEvent = useCallback((payload: TabItem) => {
    if (!payload || !payload.id || !payload.type || !payload.title) return;
    setTabs((previous) => {
      const existing = previous.find((tab) => tab.id === payload.id);
      if (existing) return previous;
      return [...previous, payload];
    });
    setActiveTabId(payload.id);
  }, []);

  const closeTabById = useCallback((id: string) => {
    setTabs((previous) => {
      const newTabs = previous.filter((tab) => tab.id !== id);
      setActiveTabId((current) => {
        if (current !== id) return current;
        return newTabs[newTabs.length - 1]?.id ?? null;
      });
      return newTabs;
    });
  }, []);

  const closeTab = useCallback((tab: TabItem, event: React.MouseEvent) => {
    event.stopPropagation();
    if (tab.isDirty) {
      setPendingCloseTab(tab);
      return;
    }
    closeTabById(tab.id);
  }, [closeTabById]);

  const handleDirtyChanged = useCallback((payload: { path: string; isDirty: boolean }) => {
    setTabs((previous) => previous.map((tab) => (tab.path === payload.path ? { ...tab, isDirty: payload.isDirty } : tab)));
  }, []);

  const handleFileRenamed = useCallback((payload: { oldPath: string; newPath: string }) => {
    setTabs((previous) =>
      previous.map((tab) => {
        if (!tab.path) return tab;
        if (tab.path === payload.oldPath) {
          return { ...tab, id: payload.newPath, path: payload.newPath, title: FileSystemService.basename(payload.newPath) };
        }
        if (isPathInside(tab.path, payload.oldPath)) {
          const newChildPath = tab.path.replace(payload.oldPath, payload.newPath);
          return { ...tab, id: newChildPath, path: newChildPath, title: FileSystemService.basename(newChildPath) };
        }
        return tab;
      }),
    );

    setActiveTabId((current) => {
      if (!current) return current;
      if (current === payload.oldPath) return payload.newPath;
      if (isPathInside(current, payload.oldPath)) return current.replace(payload.oldPath, payload.newPath);
      return current;
    });
  }, []);

  const handleFileDeleted = useCallback((payload: { path: string; isDirectory: boolean }) => {
    setTabs((previous) => {
      const newTabs = previous.filter((tab) => {
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
  }, []);

  const handleFileSaved = useCallback((payload: { path: string }) => {
    setCloseAfterSaveTabId((tabId) => {
      if (!tabId) return tabId;
      const target = tabs.find((tab) => tab.id === tabId);
      if (target?.path === payload.path) {
        closeTabById(tabId);
        setPendingCloseTab(null);
        return null;
      }
      return tabId;
    });
  }, [closeTabById, tabs]);

  useEffect(() => {
    const unsubOpenFile = EventBus.on("app:open-file", handleOpenFileEvent);
    const unsubOpenTab = EventBus.on("app:open-tab", handleOpenTabEvent);
    const unsubActivity = EventBus.on("app:activity-changed", (activity: string | null) => setActiveSidebar(activity));
    const unsubDirty = EventBus.on("editor:dirty-changed", handleDirtyChanged);
    const unsubRenamed = EventBus.on("file:renamed", handleFileRenamed);
    const unsubDeleted = EventBus.on("file:deleted", handleFileDeleted);
    const unsubSaved = EventBus.on("editor:file-saved", handleFileSaved);
    const unsubTerminal = EventBus.on("app:toggle-terminal", (force?: boolean) => setIsTerminalOpen((prev) => force !== undefined ? force : !prev));

    return () => {
      unsubOpenFile();
      unsubOpenTab();
      unsubActivity();
      unsubDirty();
      unsubRenamed();
      unsubDeleted();
      unsubSaved();
      unsubTerminal();
    };
  }, [handleDirtyChanged, handleFileDeleted, handleFileRenamed, handleFileSaved, handleOpenFileEvent, handleOpenTabEvent]);

  const renderTabContent = (tab: TabItem) => {
    if (tab.type === "file" && tab.path) return <EditorTab path={tab.path} isActive={activeTabId === tab.id} />;
    if (tab.type === "about") return <AboutTab />;
    if (tab.type === "settings") return <SettingsTab />;
    if (tab.type === "changelog") return <ChangelogTab />;
    return null;
  };

  return (
    <div className="flex h-full w-full overflow-hidden text-[13px] bg-transparent pr-[var(--WorkspaceGap)] pb-1 pl-0 gap-[var(--WorkspaceGap)]">
      <Card className="flex w-[var(--SidebarWidth)] flex-col shrink-0 z-10" style={{ display: activeSidebar ? "flex" : "none" }}>
        <div style={{ display: activeSidebar === SIDEBAR_EXPLORER ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0 }}>
          <FileExplorer onFileSelect={handleOpenFileSelect} />
        </div>
        <div style={{ display: activeSidebar === SIDEBAR_SOURCE_CONTROL ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0 }}>
          <SourceControl />
        </div>
        <div style={{ display: activeSidebar === SIDEBAR_NOTIFICATIONS ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0 }}>
          <NotificationsPanel />
        </div>
      </Card>

      <div className="flex flex-1 flex-col min-w-0 gap-[var(--WorkspaceGap)] relative">
        <Card className="flex flex-1 flex-col min-w-0 relative overflow-hidden">
          {tabs.length > 0 ? (
          <div className="flex flex-1 flex-col overflow-hidden bg-[var(--ColorEditor)] relative">
            <div className="flex h-[var(--TabBarHeight)] shrink-0 overflow-x-auto no-scrollbar bg-[var(--ColorTabInactive)] items-end px-2 pt-2 gap-1 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
              {tabs.map((tab) => {
                const isActive = activeTabId === tab.id;
                return (
                  <div
                    key={tab.id}
                    onClick={() => setActiveTabId(tab.id)}
                    className={`relative flex h-[var(--TabActiveHeight)] items-center px-3.5 text-[13px] select-none min-w-[112px] max-w-[220px] justify-between group cursor-pointer transition-colors duration-150 ${
                      isActive
                        ? "aurona-tab-active text-[var(--ColorTextHighlight)] z-10"
                        : "bg-transparent text-[var(--ColorMuted)] hover:bg-black/5 dark:hover:bg-white/10 rounded-lg mb-[2px]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
                      {tab.type === "file" && <Icons.FileCode size={16} stroke={1.5} className={isActive ? "text-[var(--ColorAccent)]" : ""} />}
                      {tab.type === "about" && <Icons.Info size={16} stroke={1.5} className={isActive ? "text-blue-500" : ""} />}
                      {tab.type === "settings" && <Icons.Settings size={16} stroke={1.5} className={isActive ? "text-gray-500" : ""} />}
                      {tab.type === "changelog" && <Icons.FileText size={16} stroke={1.5} className={isActive ? "text-green-500" : ""} />}
                      <Tooltip content={tab.path || tab.title} delay={450}>
                        <span className="block truncate max-w-[150px]">{tab.title}</span>
                      </Tooltip>
                    </div>
                    <button
                      className={`ml-3 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/20 transition-all ${
                        isActive || tab.isDirty ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      } ${isActive ? "text-[var(--ColorTextHighlight)]" : "text-[var(--ColorMuted)]"}`}
                      onClick={(event) => closeTab(tab, event)}
                      aria-label={tab.isDirty ? "未保存，关闭标签" : "关闭标签"}
                    >
                      {tab.isDirty ? (
                        <>
                          <span className="h-2 w-2 rounded-full bg-[var(--ColorAccent)] group-hover:hidden" />
                          <Icons.Close size={14} stroke={2} className="hidden group-hover:block" />
                        </>
                      ) : (
                        <Icons.Close size={14} stroke={2} />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex-1 min-h-0 overflow-hidden relative">
              {tabs.map((tab) => (
                <div key={tab.id} className="absolute inset-0 h-full w-full" style={{ visibility: activeTabId === tab.id ? "visible" : "hidden", pointerEvents: activeTabId === tab.id ? "auto" : "none" }}>
                  {renderTabContent(tab)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[var(--ColorMuted)] flex-col gap-6 select-none bg-[var(--ColorEditor)]">
            <div className="flex flex-col items-center gap-4 opacity-50 hover:opacity-80 transition-opacity duration-500">
              <img src="/logo.png" alt="Logo" className="w-24 h-24 object-contain" />
            </div>

            <div className="flex flex-col gap-3 text-xs mt-8">
              <div className="flex items-center justify-between gap-12">
                <span>快速打开文件</span>
                <span className="flex gap-1">
                  <kbd className="bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded border border-black/10 dark:border-white/20">Ctrl</kbd>
                  <kbd className="bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded border border-black/10 dark:border-white/20">P</kbd>
                </span>
              </div>
              <div className="flex items-center justify-between gap-12">
                <span>全局搜索</span>
                <span className="flex gap-1">
                  <kbd className="bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded border border-black/10 dark:border-white/20">Ctrl</kbd>
                  <kbd className="bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded border border-black/10 dark:border-white/20">Shift</kbd>
                  <kbd className="bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded border border-black/10 dark:border-white/20">F</kbd>
                </span>
              </div>
              <div className="flex items-center justify-between gap-12">
                <span>命令面板</span>
                <span className="flex gap-1">
                  <kbd className="bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded border border-black/10 dark:border-white/20">Ctrl</kbd>
                  <kbd className="bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded border border-black/10 dark:border-white/20">Shift</kbd>
                  <kbd className="bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded border border-black/10 dark:border-white/20">P</kbd>
                </span>
              </div>
            </div>
          </div>
        )}
        </Card>

        <Card className="shrink-0 flex flex-col min-w-0 relative overflow-hidden group border-t-0" style={{ height: isTerminalOpen ? "300px" : 0, display: isTerminalOpen ? "flex" : "none" }}>
          <div className="flex items-center px-3 py-1.5 bg-[var(--ColorEditor)] relative z-10 select-none border-t border-[var(--ColorPanelBorder)]">
            <div className="flex items-center gap-0.5">
                {(["problems", "output", "terminal"] as const).map((tabId) => {
                  const labels = { problems: "问题", output: "输出", terminal: "终端" };
                  const isActive = activeBottomTab === tabId;
                  const count = tabId === "problems" && editorStatus.markers?.length ? editorStatus.markers.length : null;
                  return (
                    <button
                      key={tabId}
                      onClick={() => setActiveBottomTab(tabId)}
                      className={`relative h-[26px] px-2.5 text-[12px] transition-colors duration-150 flex items-center gap-1.5 rounded-md ${
                        isActive
                          ? "bg-black/5 dark:bg-white/10 text-[var(--ColorTextHighlight)]"
                          : "text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10"
                      }`}
                    >
                      <span>{labels[tabId]}</span>
                      {count !== null && count > 0 && (
                        <span className={`flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[10px] rounded-full ${isActive ? "bg-[var(--ColorAccent)] text-white" : "bg-[var(--ColorAccent)]/20 text-[var(--ColorAccent)] font-bold"}`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex-1" />

              <div className="flex items-center gap-0.5">
                {activeBottomTab === "terminal" && (
                  <div className="flex items-center gap-0.5 mr-2 pr-2 relative after:content-[''] after:absolute after:right-0 after:top-1/2 after:-translate-y-1/2 after:w-px after:h-[14px] after:bg-[var(--ColorPanelBorder)]">
                    <Tooltip content="列表" delay={300}>
                      <button 
                        className={`flex h-[26px] w-[26px] items-center justify-center rounded-md transition-colors ${isTerminalListVisible ? 'bg-black/5 dark:bg-white/10 text-[var(--ColorTextHighlight)]' : 'text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10'}`}
                        onClick={() => setIsTerminalListVisible(!isTerminalListVisible)}
                      >
                        <Icons.List size={14} />
                      </button>
                    </Tooltip>
                    
                    <div className="relative">
                      <Tooltip content="清空终端" delay={300}>
                        <button 
                          className="flex h-[26px] w-[26px] items-center justify-center text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
                          onClick={() => {
                            if (activeTerminalId) {
                              TerminalManager.clearTerminal(activeTerminalId);
                            }
                          }}
                        >
                          <Icons.Eraser size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip content="新建终端" delay={300}>
                        <button 
                          className="flex h-[26px] w-[26px] items-center justify-center text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
                          onClick={() => TerminalManager.createTerminal()}
                        >
                          <Icons.Plus size={14} />
                        </button>
                      </Tooltip>
                      <button 
                        className="flex h-[26px] w-[16px] items-center justify-center text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors absolute -right-4 top-0"
                        onClick={() => setIsShellDropdownOpen(!isShellDropdownOpen)}
                      >
                        <Icons.ChevronDown size={10} />
                      </button>
                      {isShellDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setIsShellDropdownOpen(false)} />
                          <div className="absolute right-0 top-full mt-1 w-52 bg-[var(--ColorTitleBar)] border border-[var(--ColorPanelBorder)] rounded-lg shadow-lg z-50 p-1">
                            {availableShells.map(shell => (
                              <button
                                key={shell.id}
                                className="flex w-full cursor-pointer items-center justify-between gap-8 rounded px-3 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10 text-[var(--ColorText)] hover:text-[var(--ColorTextHighlight)] transition-colors text-[12px]"
                                onClick={() => {
                                  TerminalManager.createTerminal(shell.id);
                                  setIsShellDropdownOpen(false);
                                }}
                              >
                                {shell.name}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <Tooltip content="最小化面板" delay={300}>
                  <button className="flex h-[26px] w-[26px] items-center justify-center text-[var(--ColorMuted)] hover:text-[var(--ColorTextHighlight)] hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors" onClick={() => setIsTerminalOpen(false)}>
                    <Icons.Minimize size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
            
            <div className="flex-1 relative overflow-hidden bg-[var(--ColorEditor)] border-t border-[var(--ColorPanelBorder)] flex">
              
              {/* Terminal Always Mounted Container */}
              <div className="flex-1 relative" style={{ display: activeBottomTab === "terminal" ? "block" : "none" }}>
                {terminals.map(term => (
                  <div key={term.id} className="absolute inset-0 p-2" style={{ visibility: activeTerminalId === term.id ? "visible" : "hidden", zIndex: activeTerminalId === term.id ? 1 : 0 }}>
                    <TerminalView id={term.id} isActive={activeBottomTab === "terminal" && activeTerminalId === term.id} shellProfile={term.shell} />
                  </div>
                ))}
              </div>

              {/* Right Side Terminal List */}
              {activeBottomTab === "terminal" && isTerminalListVisible && (
                <div className="w-48 shrink-0 bg-[var(--ColorApp)] border-l border-[var(--ColorPanelBorder)] flex flex-col p-1 gap-0.5 overflow-y-auto no-scrollbar relative z-20">
                  {terminals.map(term => (
                    <div 
                      key={term.id} 
                      onClick={() => TerminalManager.setActiveTerminal(term.id)}
                      onDoubleClick={() => {
                        setEditingTerminalId(term.id);
                        setEditingName(term.name);
                      }}
                      className={`group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer select-none transition-colors ${activeTerminalId === term.id ? 'bg-[var(--ColorAccent)]/10 text-[var(--ColorAccent)]' : 'text-[var(--ColorMuted)] hover:bg-black/5 dark:hover:bg-white/10 hover:text-[var(--ColorTextHighlight)]'}`}
                    >
                      <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                        <Icons.Terminal size={14} className="shrink-0" />
                        {editingTerminalId === term.id ? (
                          <input
                            type="text"
                            autoFocus
                            value={editingName}
                            className="bg-transparent outline-none w-full text-[12px] text-[var(--ColorTextHighlight)]"
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => {
                              TerminalManager.renameTerminal(term.id, editingName);
                              setEditingTerminalId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                TerminalManager.renameTerminal(term.id, editingName);
                                setEditingTerminalId(null);
                              }
                              if (e.key === 'Escape') {
                                setEditingTerminalId(null);
                              }
                            }}
                          />
                        ) : (
                          <span className="text-[12px] truncate">{term.name}</span>
                        )}
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-black/10 dark:hover:bg-white/20 rounded transition-all shrink-0 ml-1"
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
              
              
              {activeBottomTab === "problems" && (
                <div className="absolute inset-0 p-3 flex flex-col items-start gap-1 overflow-y-auto no-scrollbar">
                  {editorStatus.markers && editorStatus.markers.length > 0 ? (
                    editorStatus.markers.map((marker, i) => (
                      <div key={i} className="flex gap-2 items-start text-left hover:bg-black/5 dark:hover:bg-white/5 w-full p-2 rounded-lg cursor-pointer selectable transition-colors">
                        <div className={`mt-0.5 shrink-0 flex items-center justify-center p-0.5 rounded ${marker.severity === 8 ? "bg-red-500/10 text-red-500" : "bg-orange-500/10 text-orange-500"}`}>
                          <Icons.AlertTriangle size={14} stroke={2} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[13px] font-medium text-[var(--ColorTextHighlight)] whitespace-pre-wrap">{marker.message}</span>
                          <span className="text-[11px] text-[var(--ColorMuted)] mt-0.5 font-mono">[{marker.source || "monaco"}] Ln {marker.line}, Col {marker.column}</span>
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
              
              {activeBottomTab === "output" && (
                <div className="absolute inset-0 p-3 font-mono text-[13px] text-[var(--ColorMuted)] overflow-y-auto no-scrollbar">
                  {/* TODO: 接管真实的 EventBus 输出流 */}
                </div>
              )}
            </div>
        </Card>
      </div>

      <Modal
        isOpen={!!pendingCloseTab}
        onClose={() => setPendingCloseTab(null)}
        title="文件尚未保存"
        icon={<Icons.AlertTriangle className="text-[var(--ColorAccent)]" size={18} stroke={2} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingCloseTab(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!pendingCloseTab) return;
                setActiveTabId(pendingCloseTab.id);
                setCloseAfterSaveTabId(pendingCloseTab.id);
                window.setTimeout(() => EventBus.emit("app:save-file"), 50);
              }}
            >
              保存并关闭
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingCloseTab) closeTabById(pendingCloseTab.id);
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
