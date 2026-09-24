import { useCallback, useEffect, useRef, useState } from "react";
import { DocumentSymbolService } from "../../Core/Language/DocumentSymbolService";
import {
  type DocumentSymbolNode,
  type FlattenedSymbol,
  flattenDocumentSymbols,
} from "../../Core/Language/SymbolUtils";
import { useLocale } from "../../Foundation/I18n";
import { GetLanguageFromPath } from "../../Shared/Utils/LanguageUtils";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { EmptyState } from "../../UI/Components/EmptyState";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";

export function OutlineView() {
  const { t } = useLocale();
  const activeFilePath = useWorkbenchStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab?.type === "file" ? tab.path : undefined;
  });
  const openFile = useWorkbenchStore((state) => state.openFile);
  const requestReveal = useWorkbenchStore((state) => state.requestReveal);
  const [symbols, setSymbols] = useState<FlattenedSymbol[]>([]);
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const generationRef = useRef(0);

  const load = useCallback(async (path: string) => {
    const generation = ++generationRef.current;
    setStatus("loading");
    try {
      const raw = await DocumentSymbolService.get(GetLanguageFromPath(path), path);
      if (generation !== generationRef.current) return;
      setSymbols(flattenDocumentSymbols(Array.isArray(raw) ? (raw as DocumentSymbolNode[]) : []));
      setStatus("idle");
    } catch {
      if (generation !== generationRef.current) return;
      setSymbols([]);
      setStatus("idle");
    }
  }, []);

  useEffect(() => {
    if (!activeFilePath) {
      generationRef.current += 1;
      setSymbols([]);
      setStatus("idle");
      return;
    }
    void load(activeFilePath);
  }, [activeFilePath, load]);

  // 未打开文件时空态对齐 Git 标杆：无 page 标题，仅发光 logo + 单行文案
  if (!activeFilePath) {
    return (
      <section className="flex h-full min-h-0 flex-col">
        <EmptyState
          className="h-full"
          icon={<Icons.List size={27} stroke={1.45} />}
          title={t("outline.title")}
          description={t("outline.empty")}
        />
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <SidebarPageHeader
        title={t("outline.title")}
        actions={
          <button
            type="button"
            aria-label={t("outline.refresh")}
            className="rounded-control p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
            onClick={() => activeFilePath && void load(activeFilePath)}
          >
            <Icons.Refresh size={16} />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--PanelPaddingX)] pb-3 no-scrollbar">
        {status === "idle" && symbols.length === 0 ? (
          <EmptyState
            className="h-full"
            icon={<Icons.List size={27} stroke={1.45} />}
            title={t("outline.noSymbols")}
            description={t("outline.noSymbolsHint")}
          />
        ) : status === "loading" ? (
          <div className="flex h-full items-center justify-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <Icons.Refresh size={14} className="animate-spin" />
            {t("outline.loading")}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {symbols.map((symbol) => (
              <button
                type="button"
                key={`${symbol.line}-${symbol.depth}-${symbol.name}-${symbol.detail ?? ""}`}
                onClick={() => {
                  if (!activeFilePath) return;
                  openFile(activeFilePath);
                  requestReveal(activeFilePath, symbol.line);
                }}
                className="flex w-full min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--material-interactive-hover)]"
                style={{ paddingLeft: `${8 + symbol.depth * 14}px` }}
              >
                <span className="shrink-0 text-[var(--color-accent)]">
                  <Icons.Sparkles size={11} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text-primary)]">
                  {symbol.name}
                </span>
                {symbol.detail && (
                  <span className="truncate text-[9px] text-[var(--color-text-muted)]">
                    {symbol.detail}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[9px] text-[var(--color-text-muted)]">
                  {symbol.line}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
