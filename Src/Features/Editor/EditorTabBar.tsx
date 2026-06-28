import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Icons } from "../../UI/Icons/IconManager";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { useWorkspace } from "../../State/WorkspaceContext";
import { EventBus } from "../../Foundation/EventBus";
import { ContextMenu, ContextMenuItem, ContextMenuDivider } from "../../UI/Components/ContextMenu";

import React from "react";

export const EditorTabBar = React.memo(function EditorTabBar() {
  const { tabs, activeTabId, setActiveTabId, closeTab, closeTabById } = useWorkspace();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const handleCloseToRight = (id: string) => {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    tabs.slice(idx + 1).forEach(t => {
      if (!t.isDirty) closeTabById(t.id);
    });
    setContextMenu(null);
  };

  const handleCloseAll = () => {
    tabs.forEach(t => {
      if (!t.isDirty) closeTabById(t.id);
    });
    setContextMenu(null);
  };

  const handleCloseCurrent = (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (tab) {
      if (tab.isDirty) {
        closeTab(tab);
      } else {
        closeTabById(id);
      }
    }
    setContextMenu(null);
  };

  if (tabs.length === 0) return null;

  return (
    <div className="flex h-[var(--TabBarHeight)] shrink-0 overflow-x-auto overflow-y-hidden no-scrollbar bg-transparent items-center px-1 py-1 gap-1.5 z-20">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
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
              {tab.type === "file" && <Icons.FileCode size={16} stroke={1.5} className={`shrink-0 ${isActive ? "text-[var(--TextHighlight)]" : ""}`} />}
              {tab.type === "about" && <Icons.Info size={16} stroke={1.5} className={`shrink-0 ${isActive ? "text-blue-500" : ""}`} />}
              {tab.type === "settings" && <Icons.Settings size={16} stroke={1.5} className={`shrink-0 ${isActive ? "text-[var(--TextHighlight)]" : ""}`} />}
              {tab.type === "changelog" && <Icons.FileText size={16} stroke={1.5} className={`shrink-0 ${isActive ? "text-[var(--TextHighlight)]" : ""}`} />}
              <Tooltip content={tab.path || tab.title} delay={450} placement="bottom">
                <span className={`block truncate max-w-[150px] transition-opacity duration-200 ${!isActive ? "opacity-60" : "opacity-100"}`}>
                  {tab.title}
                </span>
              </Tooltip>
            </div>
            <button
              className={`ml-3 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/20 transition-all z-10 relative ${
                isActive || tab.isDirty ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              } ${isActive ? "text-[var(--TextHighlight)]" : "text-[var(--TextMuted)]"}`}
              onClick={(e) => { e.stopPropagation(); closeTab(tab); }}
              aria-label={tab.isDirty ? "未保存，关闭标签" : "关闭标签"}
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
        );
      })}

      {contextMenu && (
        <ContextMenu 
          x={contextMenu.x} 
          y={contextMenu.y} 
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem 
            icon={<Icons.Close size={14} />} 
            label="关闭当前" 
            onClick={() => handleCloseCurrent(contextMenu.tabId)} 
          />
          <ContextMenuItem 
            icon={<Icons.ArrowRight size={14} />} 
            label="关闭右侧" 
            onClick={() => handleCloseToRight(contextMenu.tabId)} 
          />
          <ContextMenuDivider />
          <ContextMenuItem 
            icon={<Icons.Trash size={14} />} 
            label="关闭全部" 
            variant="danger" 
            onClick={handleCloseAll} 
          />
        </ContextMenu>
      )}
    </div>
  );
});
