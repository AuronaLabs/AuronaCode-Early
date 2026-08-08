import { useEffect, useRef, useState } from "react";
import { LspClient } from "../../../Core/Language/LspClient";
import {
  type DocumentSymbolNode,
  type FlattenedSymbol,
  flattenDocumentSymbols,
} from "../../../Core/Language/SymbolUtils";
import { useEditorStore } from "../../../State/useEditorStore";
import { useWorkbenchStore } from "../../../State/useWorkspaceStore";
import { Icons } from "../../../UI/Icons/IconManager";

export function EditorBreadcrumb({ path, language }: { path: string; language: string }) {
  const openFile = useWorkbenchStore((state) => state.openFile);
  const requestReveal = useWorkbenchStore((state) => state.requestReveal);
  const currentLine = useEditorStore((state) => state.editorStatus.line);
  const [symbols, setSymbols] = useState<FlattenedSymbol[]>([]);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    void LspClient.getInstance()
      .getDocumentSymbols(language, path)
      .then((raw) => {
        if (generation !== generationRef.current) return;
        setSymbols(flattenDocumentSymbols(Array.isArray(raw) ? (raw as DocumentSymbolNode[]) : []));
      })
      .catch(() => {
        if (generation === generationRef.current) setSymbols([]);
      });
    return () => {
      generationRef.current += 1;
    };
  }, [language, path]);

  const activeSymbols = symbols
    .filter(
      (symbol) => symbol.line <= currentLine && (symbol.endLine ?? symbol.line) >= currentLine,
    )
    .sort((left, right) => left.depth - right.depth);

  const segments = path.split(/[\\/]/).filter(Boolean);
  const fileName = segments.at(-1) ?? path;
  const dirs = segments.slice(0, -1);

  return (
    <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-3 text-[10px] text-[var(--color-text-muted)] aurona-scroll">
      <Icons.FileCode size={12} className="shrink-0" />
      {dirs.map((dir) => (
        <span key={dir} className="flex items-center gap-1 whitespace-nowrap">
          {dir}
          <Icons.ChevronRight size={10} />
        </span>
      ))}
      <span className="whitespace-nowrap font-medium text-[var(--color-text-highlight)]">
        {fileName}
      </span>
      {activeSymbols.map((symbol) => (
        <button
          type="button"
          key={`${symbol.line}-${symbol.depth}-${symbol.name}`}
          onClick={() => {
            openFile(path);
            requestReveal(path, symbol.line);
          }}
          className="flex items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[var(--color-accent)] transition-colors hover:bg-[var(--material-interactive-hover)]"
        >
          <Icons.ChevronRight size={10} />
          {symbol.name}
        </button>
      ))}
    </div>
  );
}
