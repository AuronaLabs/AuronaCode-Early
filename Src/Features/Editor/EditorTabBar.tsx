import React from "react";
import { EventBus } from "../../Foundation/EventBus";
import { useWorkspaceStore } from "../../State/useWorkspaceStore";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuDivider,
} from "../../UI/Components/ContextMenu";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";

export const EditorTabBar = React.memo(function EditorTabBar() {
  const { tabs, activeTabId, setActiveTabId, closeTab, closeTabById } = useWorkspaceStore();

  const handleCloseToRight = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    tabs.slice(idx + 1).forEach((t) => {
      if (!t.isDirty) closeTabById(t.id);
    });
  };

  const handleCloseAll = () => {
    tabs.forEach((t) => {
      if (!t.isDirty) closeTabById(t.id);
    });
  };

  const handleCloseCurrent = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      if (tab.isDirty) {
        closeTab(tab);
      } else {
        closeTabById(id);
      }
    }
  };

  if (tabs.length === 0) return null;

  return (
    <div className="flex h-[var(--TabBarHeight)] shrink-0 overflow-x-auto overflow-y-hidden no-scrollbar items-center px-1 py-1 gap-1.5 z-20 bg-transparent">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        return (
          <ContextMenuRoot key={tab.id}>
            <ContextMenuTrigger asChild>
              <div
                onClick={() => setActiveTabId(tab.id)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTabById(tab.id);
                  }
                }}
                className={`aurona-tab flex items-center px-3.5 text-[13px] select-none min-w-[112px] max-w-[220px] justify-between group cursor-pointer shrink-0 ${
                  isActive ? "aurona-tab-active" : ""
                }`}
              >
                <div className="flex items-center gap-2.5 overflow-hidden min-w-0 z-10 relative">
                  {tab.type === "file" && (
                    <Icons.FileCode
                      size={16}
                      stroke={1.5}
                      className={`shrink-0 ${isActive ? "text-[var(--TextHighlight)]" : ""}`}
                    />
                  )}
                  {tab.type === "about" && (
                    <Icons.Info
                      size={16}
                      stroke={1.5}
                      className={`shrink-0 ${isActive ? "text-blue-500" : ""}`}
                    />
                  )}
                  {tab.type === "settings" && (
                    <Icons.Settings
                      size={16}
                      stroke={1.5}
                      className={`shrink-0 ${isActive ? "text-[var(--TextHighlight)]" : ""}`}
                    />
                  )}
                  {tab.type === "changelog" && (
                    <Icons.FileText
                      size={16}
                      stroke={1.5}
                      className={`shrink-0 ${isActive ? "text-[var(--TextHighlight)]" : ""}`}
                    />
                  )}
                  {tab.type === "diff" && (
                    <Icons.GitBranch
                      size={16}
                      stroke={1.5}
                      className={`shrink-0 ${isActive ? "text-purple-400" : ""}`}
                    />
                  )}
                  <span
                    className={`truncate tracking-wide pt-0.5 ${
                      tab.isDirty ? "italic font-medium" : ""
                    } ${isActive ? "text-[var(--TextHighlight)] font-medium" : "text-[var(--TextMuted)] group-hover:text-[var(--TextNormal)]"}`}
                  >
                    {tab.title}
                  </span>
                </div>
                <button
                  className={`ml-3 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/20 transition-all z-10 relative ${
                    isActive || tab.isDirty ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  } ${isActive ? "text-[var(--TextHighlight)]" : "text-[var(--TextMuted)]"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab);
                  }}
                  aria-label={tab.isDirty ? "未保存，关闭标签" : "关闭标签"}
                  type="button"
                >
                  {tab.isDirty ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-[var(--TextHighlight)] group-hover:hidden" />
                      <Icons.Close size={14} stroke={2} className="hidden group-hover:block" />
                    </>
                  ) : (
                    <Icons.Close size={14} stroke={2} />
                  )}
                </button>
              </div>
            </ContextMenuTrigger>

            <ContextMenuContent>
              <ContextMenuItem label="关闭当前" onSelect={() => handleCloseCurrent(tab.id)} />
              <ContextMenuItem label="关闭右侧" onSelect={() => handleCloseToRight(tab.id)} />
              <ContextMenuDivider />
              <ContextMenuItem label="关闭全部" variant="danger" onSelect={handleCloseAll} />
              {tab.type === "file" && tab.path && (
                <>
                  <ContextMenuDivider />
                  <ContextMenuItem
                    label="复制路径"
                    onSelect={() => {
                      navigator.clipboard.writeText(tab.path as string);
                    }}
                  />
                  <ContextMenuItem
                    label="在资源管理器中显示"
                    onSelect={() => {
                      EventBus.emit("app:reveal-in-explorer", tab.path as string);
                    }}
                  />
                </>
              )}
            </ContextMenuContent>
          </ContextMenuRoot>
        );
      })}
    </div>
  );
});
