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

  return (
    <section className="flex h-full min-h-0 flex-col">
      <SidebarPageHeader
        title={t("outline.title")}
        actions={
          <button
            type="button"
            aria-label={t("outline.refresh")}
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
            onClick={() => activeFilePath && void load(activeFilePath)}
          >
            <Icons.Refresh size={16} />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--PanelPaddingX)] pb-3 no-scrollbar">
        {!activeFilePath || (status === "idle" && symbols.length === 0) ? (
          <div className="relative flex h-full min-h-0 flex-col items-center justify-center gap-5 px-6 text-center">
            <div className="pointer-events-none absolute h-44 w-44 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] blur-3xl" />
            <div className="relative">
              <div className="absolute inset-0 scale-125 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] blur-xl" />
              <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--color-accent)_22%,var(--border-subtle))] bg-[var(--material-surface)] text-[var(--color-accent)]">
                <Icons.List size={24} stroke={1.45} />
              </div>
            </div>
            <div className="relative z-10 space-y-1.5">
              <h3 className="text-[13px] font-semibold text-[var(--color-text-highlight)]">
                {activeFilePath ? t("outline.noSymbols") : t("outline.title")}
              </h3>
              <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                {activeFilePath ? t("outline.noSymbolsHint") : t("outline.empty")}
              </p>
            </div>
          </div>
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
                className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--material-interactive-hover)]"
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
