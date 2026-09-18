import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type LocationResultItem, LocationResultsStore } from "../../Core/LocationResultsStore";
import { useLocale } from "../../Foundation/I18n";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Badge } from "../../UI/Components/Badge";
import { Icons } from "../../UI/Icons/IconManager";

export function LocationResultsPanel() {
  const { t } = useLocale();
  const state = useSyncExternalStore(
    LocationResultsStore.subscribe,
    () => LocationResultsStore.getSnapshot(),
    () => LocationResultsStore.getSnapshot(),
  );
  const openFile = useWorkbenchStore((store) => store.openFile);
  const requestReveal = useWorkbenchStore((store) => store.requestReveal);
  const setBottomPanelOpen = useWorkbenchStore((store) => store.setBottomPanelOpen);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const requestId = state?.requestId;
  useEffect(() => {
    void requestId;
    setSelectedIndex(0);
    containerRef.current?.focus();
  }, [requestId]);

  const groups = useMemo(() => {
    if (!state) return [];
    const map = new Map<string, LocationResultItem[]>();
    for (const item of state.items) {
      const list = map.get(item.path) ?? [];
      list.push(item);
      map.set(item.path, list);
    }
    return [...map.entries()].map(([path, items]) => ({ path, items }));
  }, [state]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const element = container.querySelector<HTMLElement>(
      `[data-location-index="${selectedIndex}"]`,
    );
    element?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!state || state.items.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 opacity-70">
        <Icons.Search size={24} stroke={1.5} />
        <span className="text-[12px]">{t("locationResults.empty")}</span>
      </div>
    );
  }

  const title = t(
    state.kind === "definition" ? "locationResults.definitions" : "locationResults.references",
  );

  const jump = (item: LocationResultItem) => {
    openFile(item.path);
    requestReveal(item.path, item.line);
  };

  const moveSelection = (offset: number) => {
    setSelectedIndex((index) => Math.min(Math.max(index + offset, 0), state.items.length - 1));
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setSelectedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setSelectedIndex(state.items.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = state.items[selectedIndex];
      if (item) jump(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setBottomPanelOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="listbox"
      aria-label={title}
      onKeyDown={onKeyDown}
      className="h-full w-full overflow-y-auto p-2 outline-none aurona-scroll"
    >
      <div className="mb-2 flex items-center gap-2 px-1 text-[11px] text-[var(--color-text-muted)]">
        <span className="font-semibold text-[var(--color-text-highlight)]">{title}</span>
        <span>
          {t("locationResults.resultsCount").replace("{count}", String(state.items.length))}
        </span>
        <span className="ml-auto">{t("locationResults.jumpHint")}</span>
      </div>

      <div className="flex flex-col gap-2">
        {groups.map((group) => (
          <section
            key={group.path}
            className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--material-surface)]"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
              <Icons.FileCode size={13} className="shrink-0 text-[var(--color-text-muted)]" />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                {group.path}
              </span>
              <Badge variant="neutral">{group.items.length}</Badge>
            </div>
            {group.items.map((item) => {
              const index = state.items.indexOf(item);
              const selected = index === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-location-index={index}
                  onClick={() => jump(item)}
                  onMouseMove={() => setSelectedIndex(index)}
                  className={`flex w-full items-start gap-3 px-3 py-1.5 text-left transition-colors ${
                    selected
                      ? "bg-[var(--material-interactive-active)]"
                      : "hover:bg-[var(--material-interactive-hover)]"
                  }`}
                >
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] leading-5 text-[var(--color-text-muted)]">
                    {item.line}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-5 text-[var(--color-text-primary)]">
                    {item.previewLoading ? (
                      <span className="text-[var(--color-text-muted)]">
                        {t("locationResults.noPreview")}
                      </span>
                    ) : (
                      <>
                        {item.preview.slice(0, item.matchStart ?? 0)}
                        {item.matchStart !== undefined && item.matchEnd !== undefined && (
                          <mark className="rounded-[2px] bg-[var(--color-accent)]/30 text-[var(--color-text-highlight)]">
                            {item.preview.slice(item.matchStart, item.matchEnd)}
                          </mark>
                        )}
                        {item.preview.slice(item.matchEnd ?? item.preview.length)}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
