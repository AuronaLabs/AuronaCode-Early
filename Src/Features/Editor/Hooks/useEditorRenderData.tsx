import type { ComponentProps, ReactNode, RefObject } from "react";
import { useCallback, useMemo, useRef } from "react";
import { EditorLine } from "../components/EditorLine";
import type { EditorHoverState } from "../components/HoverCard";
import type { FoldingLineMap } from "../Folding/FoldingLineMap";
import { GitGutterBar } from "../GitGutter/GitGutterBar";
import { findHunkAtLine, type GitGutterHunk } from "../GitGutter/parseUnifiedDiff";
import { collectMinimapDecorations, type MinimapDecoration } from "../Minimap/MinimapDecorations";
import type { EditorLayoutMetrics } from "../Utils/EditorLayoutMetrics";
import type { DiagnosticItem } from "../Utils/EditorMath";
import { diagnosticsForLine } from "../Utils/EditorMath";
import type { EditorSearchMatch } from "./useEditorSearch";
import type { SelectionRange } from "./useEditorSelectionOps";

type Occurrences = ComponentProps<typeof EditorLine>["occurrences"];

/** 空匹配常量：未命中行共享同一引用，保证 EditorLine memo 命中 */
const EMPTY_SEARCH_LINE_MATCHES: { char: number; length?: number }[] = [];

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
  /** 真实折叠启用时传入：视口按可视行迭代，行内坐标映射回真实行 */
  lineMap?: FoldingLineMap | null;
  /** 折叠起始行 → 隐藏行数（折叠胶囊计数显示用） */
  foldedHiddenCounts?: Map<number, number>;
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
    hunks: GitGutterHunk[];
  };
  /** 点击 gutter 变化行指示条时打开 hunk 浮层 */
  onOpenHunk?: (hunk: GitGutterHunk, anchor: DOMRect) => void;
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
  lineMap,
  foldedHiddenCounts,
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
  onOpenHunk,
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

  // 18.5 行级预计算（0.4.6 增量渲染）：
  // - 搜索匹配按行分组（Map），未命中行共享 EMPTY 常量引用；
  // - 诊断按 (line:length) 缓存，未变行复用旧数组引用；
  // 两者让 EditorLine 的 React.memo 在纯光标移动/单行编辑时命中。
  const searchMatchesByLine = useMemo(() => {
    const map = new Map<number, { char: number; length?: number }[]>();
    for (const match of searchMatches) {
      const list = map.get(match.line);
      if (list) list.push(match);
      else map.set(match.line, [match]);
    }
    return map;
  }, [searchMatches]);

  const lineDiagsCacheRef = useRef<{
    source: DiagnosticItem[];
    cache: Map<string, DiagnosticItem[]>;
  }>({ source: diagnostics, cache: new Map() });
  if (lineDiagsCacheRef.current.source !== diagnostics) {
    lineDiagsCacheRef.current = { source: diagnostics, cache: new Map() };
  }
  const lineDiagsFor = useCallback((idx: number, length: number) => {
    const cache = lineDiagsCacheRef.current.cache;
    const key = `${idx}:${length}`;
    let value = cache.get(key);
    if (!value) {
      value = diagnosticsForLine(lineDiagsCacheRef.current.source, idx, length);
      cache.set(key, value);
    }
    return value;
  }, []);

  // 稳定行事件处理器（latest-ref 模式）：引用恒定，行为始终读最新值，
  // 消除"每行内联闭包"导致的 EditorLine memo 全量失效。
  const latestLineHandlersRef = useRef({
    textIndexAtPoint,
    addCursor,
    clearExtraCursors,
    handleLineMouseDown,
    hasExtraCursors: extraCursors.length > 0,
    textareaRef,
  });
  latestLineHandlersRef.current = {
    textIndexAtPoint,
    addCursor,
    clearExtraCursors,
    handleLineMouseDown,
    hasExtraCursors: extraCursors.length > 0,
    textareaRef,
  };
  const stableLineMouseDown = useCallback((idx: number, e: React.MouseEvent<HTMLButtonElement>) => {
    const handlers = latestLineHandlersRef.current;
    // Alt+Click：添加额外光标
    if (e.altKey && e.button === 0) {
      const charIndex = handlers.textIndexAtPoint(idx, e.currentTarget, e.clientX, e.clientY);
      handlers.addCursor({ line: idx, char: charIndex });
      handlers.textareaRef.current?.focus();
      e.preventDefault();
      return;
    }
    // 常规指针交互：清除额外光标
    if (handlers.hasExtraCursors) handlers.clearExtraCursors();
    handlers.handleLineMouseDown(idx, e);
  }, []);

  // 19. 视口行渲染（迭代可视空间；真实折叠启用时映射回真实行号）
  const visibleLinesDOM = useMemo(() => {
    const list = [];
    for (let visual = visibleStartIndex; visual < visibleEndIndex; visual++) {
      const idx = lineMap ? lineMap.getRealLine(visual) : visual;
      const lineText = documentLines[idx] ?? "";
      const isCurrent = idx === cursor.line;
      const tokens = isLargeFileMode ? largeLineTokens.get(idx) || [] : linesTokens[idx] || [];
      const lineDiags = lineDiagsFor(idx, lineText.length);
      const searchLineMatches = searchMatchesByLine.get(idx) ?? EMPTY_SEARCH_LINE_MATCHES;
      const isFoldedStart = foldedStartLines.has(idx);
      const foldedHiddenCount = foldedHiddenCounts?.get(idx);

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
          onMouseDown={stableLineMouseDown}
          onMouseLeave={handleLineMouseLeave}
          onLanguageHover={requestLanguageHover}
          textIndexAtPoint={textIndexAtPoint}
          registerLineElement={registerLineElement}
          isComposing={isComposing}
          compositionText={compositionText}
          compositionChar={cursor.char}
          layout={layout}
          isFoldedStart={isFoldedStart}
          foldedHiddenCount={foldedHiddenCount}
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
    searchMatches,
    foldedStartLines,
    foldedHiddenCounts,
    lineMap,
    searchQuery,
    currentMatchIndex,
    selection,
    setVisibleHover,
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
    isDraggingRef,
    lineDiagsFor,
    stableLineMouseDown,
    searchMatchesByLine,
  ]);

  // 20. 行号与折叠三角（可视空间迭代；行号显示真实行号）
  const lineNumbersDOM = useMemo(() => {
    const list = [];
    for (let visual = visibleStartIndex; visual < visibleEndIndex; visual++) {
      const idx = lineMap ? lineMap.getRealLine(visual) : visual;
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

          {/* Git 边栏指示条（变化行可点击查看 hunk 浮层） */}
          <GitGutterBar
            isAdded={gitGutterDiff.addedLines.has(idx)}
            isModified={gitGutterDiff.modifiedLines.has(idx)}
            isDeleted={gitGutterDiff.deletedLines.has(idx)}
            onClick={
              onOpenHunk
                ? (() => {
                    const hunk = findHunkAtLine(gitGutterDiff.hunks, idx);
                    return hunk ? (anchor: DOMRect) => onOpenHunk(hunk, anchor) : undefined;
                  })()
                : undefined
            }
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
    lineMap,
    layout.lineHeight,
    toggleFold,
    path,
    toggleBreakpoint,
    gitGutterDiff,
    onOpenHunk,
  ]);

  return { minimapDecorations, visibleLinesDOM, lineNumbersDOM };
}
