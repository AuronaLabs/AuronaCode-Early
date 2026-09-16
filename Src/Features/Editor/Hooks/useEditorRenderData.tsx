import type { ComponentProps, ReactNode, RefObject } from "react";
import { useMemo } from "react";
import { EditorLine } from "../components/EditorLine";
import type { EditorHoverState } from "../components/HoverCard";
import { GitGutterBar } from "../GitGutter/GitGutterBar";
import { collectMinimapDecorations, type MinimapDecoration } from "../Minimap/MinimapDecorations";
import type { EditorLayoutMetrics } from "../Utils/EditorLayoutMetrics";
import type { DiagnosticItem } from "../Utils/EditorMath";
import { diagnosticsForLine } from "../Utils/EditorMath";
import type { EditorSearchMatch } from "./useEditorSearch";
import type { SelectionRange } from "./useEditorSelectionOps";

type Occurrences = ComponentProps<typeof EditorLine>["occurrences"];

export interface UseEditorRenderDataParams {
  documentLines: string[];
  cursor: { line: number; char: number };
  selection: SelectionRange | null;
  visibleStartIndex: number;
  visibleEndIndex: number;
  layout: EditorLayoutMetrics;
  linesTokens: number[][];
  largeLineTokens: Map<number, number[]>;
  isLargeFileMode: boolean;
  diagnostics: DiagnosticItem[];
  searchQuery: string;
  searchMatches: EditorSearchMatch[];
  currentMatchIndex: number;
  foldedStartLines: Set<number>;
  foldableRanges: { startLine: number }[];
  occurrences: Occurrences;
  isComposing: boolean;
  compositionText: string;
  path?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 来自 useEditorCompletion / useEditorPointerClipboard / 多光标 */
  isDraggingRef: RefObject<boolean>;
  setVisibleHover: (next: EditorHoverState | null) => void;
  requestLanguageHover: ComponentProps<typeof EditorLine>["onLanguageHover"];
  handleLineMouseLeave: ComponentProps<typeof EditorLine>["onMouseLeave"];
  handleLineMouseDown: (idx: number, e: React.MouseEvent<HTMLButtonElement>) => void;
  textIndexAtPoint: (
    lineIndex: number,
    lineElement: HTMLButtonElement,
    clientX: number,
    clientY: number,
  ) => number;
  registerLineElement: (lineIndex: number, element: HTMLButtonElement | null) => void;
  toggleFold: (line: number) => void;
  toggleBreakpoint: (path: string, line: number) => void;
  gitGutterDiff: {
    addedLines: Set<number>;
    modifiedLines: Set<number>;
    deletedLines: Set<number>;
  };
  addCursor: (cursor: { line: number; char: number }) => void;
  extraCursors: unknown[];
  clearExtraCursors: () => void;
}

/** 视口行 DOM、行号 gutter 与 Minimap 装饰标记三个渲染 memo。 */
export function useEditorRenderData({
  documentLines,
  cursor,
  selection,
  visibleStartIndex,
  visibleEndIndex,
  layout,
  linesTokens,
  largeLineTokens,
  isLargeFileMode,
  diagnostics,
  searchQuery,
  searchMatches,
  currentMatchIndex,
  foldedStartLines,
  foldableRanges,
  occurrences,
  isComposing,
  compositionText,
  path,
  textareaRef,
  isDraggingRef,
  setVisibleHover,
  requestLanguageHover,
  handleLineMouseLeave,
  handleLineMouseDown,
  textIndexAtPoint,
  registerLineElement,
  toggleFold,
  toggleBreakpoint,
  gitGutterDiff,
  addCursor,
  extraCursors,
  clearExtraCursors,
}: UseEditorRenderDataParams): {
  minimapDecorations: MinimapDecoration[];
  visibleLinesDOM: ReactNode;
  lineNumbersDOM: ReactNode;
} {
  // 18. Minimap 装饰标记计算
  const minimapDecorations = useMemo(() => {
    return collectMinimapDecorations(diagnostics, searchMatches, selection);
  }, [diagnostics, searchMatches, selection]);

  // 19. 视口行渲染
  const visibleLinesDOM = useMemo(() => {
    const list = [];
    for (let idx = visibleStartIndex; idx < visibleEndIndex; idx++) {
      const lineText = documentLines[idx] ?? "";
      const isCurrent = idx === cursor.line;
      const tokens = isLargeFileMode ? largeLineTokens.get(idx) || [] : linesTokens[idx] || [];
      const lineDiags = diagnosticsForLine(diagnostics, idx, lineText.length);
      const searchLineMatches = searchMatches.filter((m) => m.line === idx);
      const isFoldedStart = foldedStartLines.has(idx);

      list.push(
        <EditorLine
          key={idx}
          idx={idx}
          lineText={lineText}
          isCurrent={isCurrent}
          tokens={tokens}
          searchQuery={searchQuery}
          searchLineMatches={searchLineMatches}
          currentMatchIndex={currentMatchIndex}
          searchMatches={searchMatches}
          lineDiags={lineDiags}
          selection={selection}
          isDragging={isDraggingRef.current}
          setHoverTooltip={setVisibleHover}
          onMouseDown={(idx, e) => {
            // Alt+Click：添加额外光标
            if (e.altKey && e.button === 0) {
              const charIndex = textIndexAtPoint(idx, e.currentTarget, e.clientX, e.clientY);
              addCursor({ line: idx, char: charIndex });
              textareaRef.current?.focus();
              e.preventDefault();
              return;
            }
            // 常规指针交互：清除额外光标
            if (extraCursors.length > 0) clearExtraCursors();
            handleLineMouseDown(idx, e);
          }}
          onMouseLeave={handleLineMouseLeave}
          onLanguageHover={requestLanguageHover}
          textIndexAtPoint={textIndexAtPoint}
          registerLineElement={registerLineElement}
          isComposing={isComposing}
          compositionText={compositionText}
          compositionChar={cursor.char}
          layout={layout}
          isFoldedStart={isFoldedStart}
          onToggleFold={toggleFold}
          occurrences={occurrences}
        />,
      );
    }
    return list;
  }, [
    visibleStartIndex,
    visibleEndIndex,
    documentLines,
    cursor.line,
    linesTokens,
    largeLineTokens,
    isLargeFileMode,
    diagnostics,
    searchMatches,
    foldedStartLines,
    searchQuery,
    currentMatchIndex,
    selection,
    setVisibleHover,
    handleLineMouseDown,
    handleLineMouseLeave,
    requestLanguageHover,
    textIndexAtPoint,
    registerLineElement,
    isComposing,
    compositionText,
    cursor.char,
    layout,
    toggleFold,
    occurrences,
    isDraggingRef.current,
    addCursor,
    extraCursors,
    clearExtraCursors,
    textareaRef.current?.focus,
  ]);

  // 20. 行号与折叠三角
  const lineNumbersDOM = useMemo(() => {
    const list = [];
    for (let idx = visibleStartIndex; idx < visibleEndIndex; idx++) {
      const isCurrent = idx === cursor.line;
      const isFoldable = foldableRanges.some((r) => r.startLine === idx);
      const isFolded = foldedStartLines.has(idx);

      list.push(
        <div
          key={idx}
          className="group/line relative w-full flex items-center justify-between px-1.5 select-none"
          style={{ height: layout.lineHeight, lineHeight: `${layout.lineHeight}px` }}
        >
          {/* 当前行 gutter 指示：accent 侧标 */}
          {isCurrent && (
            <span className="absolute left-0 top-0.5 bottom-0.5 w-[2px] rounded-full bg-[var(--color-accent)]" />
          )}

          {/* 折叠触发三角 */}
          {isFoldable ? (
            <button
              type="button"
              onClick={() => toggleFold(idx)}
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] transition-transform"
            >
              {isFolded ? "▶" : "▼"}
            </button>
          ) : (
            <span className="w-2.5" />
          )}

          <button
            type="button"
            onClick={() => {
              if (path) toggleBreakpoint(path, idx + 1);
            }}
            className={`flex-1 text-right pr-2 font-mono text-[12px] ${
              isCurrent
                ? "text-[var(--color-text-highlight)] font-bold"
                : "text-[var(--color-text-muted)] opacity-60"
            }`}
          >
            {idx + 1}
          </button>

          {/* Git 边栏指示条 */}
          <GitGutterBar
            isAdded={gitGutterDiff.addedLines.has(idx)}
            isModified={gitGutterDiff.modifiedLines.has(idx)}
            isDeleted={gitGutterDiff.deletedLines.has(idx)}
          />
        </div>,
      );
    }
    return list;
  }, [
    visibleStartIndex,
    visibleEndIndex,
    cursor.line,
    foldableRanges,
    foldedStartLines,
    layout.lineHeight,
    toggleFold,
    path,
    toggleBreakpoint,
    gitGutterDiff,
  ]);

  return { minimapDecorations, visibleLinesDOM, lineNumbersDOM };
}
