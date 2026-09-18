import { memo, useCallback, useEffect, useRef, useState } from "react";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import {
  ContextMenuContent,
  ContextMenuDivider,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "../../UI/Components/ContextMenu";
import { Icons } from "../../UI/Icons/IconManager";

export const EditorTabBar = memo(function EditorTabBar() {
  const { t } = useLocale();
  const { tabs, activeTabId, setActiveTabId, closeTab, closeTabById } = useWorkbenchStore();

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 保留 4px 回滞，避免在边缘来回移动时箭头反复出现/消失。
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    void tabs.length;
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [tabs.length, updateScrollState]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
    target?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [activeTabId]);

  const scrollTabs = useCallback((direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.max(200, el.clientWidth * 0.6);
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  }, []);

  if (tabs.length === 0) return null;

  return (
    <div className="aurona-tabbar flex h-[var(--TabBarHeight)] shrink-0 items-stretch">
      <div
        ref={scrollRef}
        className="aurona-tabbar-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden px-1 py-1 no-scrollbar"
      >
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          return (
            <ContextMenuRoot key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  data-tab-id={tab.id}
                  tabIndex={0}
                  aria-selected={isActive}
                  onClick={() => setActiveTabId(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveTabId(tab.id);
                    }
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      closeTab(tab);
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
                        className={`shrink-0 ${isActive ? "text-[var(--color-text-highlight)]" : ""}`}
                      />
                    )}
                    {tab.type === "about" && (
                      <Icons.Info size={16} stroke={1.5} className="shrink-0" />
                    )}
                    {tab.type === "settings" && (
                      <Icons.Settings
                        size={16}
                        stroke={1.5}
                        className={`shrink-0 ${isActive ? "text-[var(--color-text-highlight)]" : ""}`}
                      />
                    )}
                    {tab.type === "changelog" && (
                      <Icons.FileText
                        size={16}
                        stroke={1.5}
                        className={`shrink-0 ${isActive ? "text-[var(--color-text-highlight)]" : ""}`}
                      />
                    )}
                    {tab.type === "performance" && (
                      <Icons.History
                        size={16}
                        stroke={1.5}
                        className={`shrink-0 ${isActive ? "text-[var(--color-text-highlight)]" : ""}`}
                      />
                    )}
                    {tab.type === "diff" && (
                      <Icons.GitBranch size={16} stroke={1.5} className="shrink-0" />
                    )}
                    {tab.type === "fliuno" && (
                      <Icons.Search size={16} stroke={1.5} className="shrink-0" />
                    )}
                    {tab.type === "extension" && (
                      <Icons.Extensions
                        size={16}
                        stroke={1.5}
                        className={`shrink-0 ${isActive ? "text-[var(--color-accent)]" : ""}`}
                      />
                    )}
                    <span
                      className={`truncate tracking-wide pt-0.5 ${
                        tab.isDirty ? "italic font-medium" : ""
                      } ${isActive ? "text-[var(--color-text-highlight)] font-medium" : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)]"}`}
                    >
                      {tab.titleKey ? t(tab.titleKey) : tab.title}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`ml-3 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-lg hover:bg-[var(--material-interactive-hover)] transition-all z-10 relative ${
                      isActive || tab.isDirty ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    } ${isActive ? "text-[var(--color-text-highlight)]" : "text-[var(--color-text-muted)]"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab);
                    }}
                    aria-label={
                      tab.isDirty ? t("editorTabBar.closeDirtyTab") : t("editorTabBar.closeTab")
                    }
                  >
                    {tab.isDirty ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-[var(--color-text-highlight)] group-hover:hidden" />
                        <Icons.Close size={14} stroke={2} className="hidden group-hover:block" />
                      </>
                    ) : (
                      <Icons.Close size={14} stroke={2} />
                    )}
                  </button>
                </div>
              </ContextMenuTrigger>

              <ContextMenuContent>
                <ContextMenuItem
                  label={t("editorTabBar.closeCurrent")}
                  onSelect={() => handleCloseCurrent(tab.id)}
                />
                <ContextMenuItem
                  label={t("editorTabBar.closeToRight")}
                  onSelect={() => handleCloseToRight(tab.id)}
                />
                <ContextMenuDivider />
                <ContextMenuItem
                  label={t("editorTabBar.closeAll")}
                  variant="danger"
                  onSelect={handleCloseAll}
                />
                {tab.type === "file" && tab.path && (
                  <>
                    <ContextMenuDivider />
                    <ContextMenuItem
                      label={t("editorTabBar.copyPath")}
                      onSelect={() => {
                        navigator.clipboard.writeText(tab.path as string);
                      }}
                    />
                    <ContextMenuItem
                      label={t("editorTabBar.revealInExplorer")}
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
      <div className="flex shrink-0 items-center gap-0.5 border-l border-[var(--border-subtle)] px-1.5">
        <button
          type="button"
          aria-label={t("editorTabBar.scrollLeft")}
          onClick={() => scrollTabs(-1)}
          disabled={!canScrollLeft}
          className="grid size-6 place-items-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-muted)]"
        >
          <Icons.ChevronLeft size={15} stroke={2} />
        </button>
        <button
          type="button"
          aria-label={t("editorTabBar.scrollRight")}
          onClick={() => scrollTabs(1)}
          disabled={!canScrollRight}
          className="grid size-6 place-items-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-muted)]"
        >
          <Icons.ChevronRight size={15} stroke={2} />
        </button>
      </div>
    </div>
  );
});
