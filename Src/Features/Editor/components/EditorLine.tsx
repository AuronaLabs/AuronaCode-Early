import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FoldedPlaceholder } from "../Folding/FoldedPlaceholder";
import type { OccurrenceMatch } from "../MultiCursor/useSelectionOccurrence";
import {
  type EditorLayoutMetrics,
  measureEditorText,
  measureRenderedEditorAnchor,
  measureRenderedEditorRange,
} from "../Utils/EditorLayoutMetrics";
import { type DiagnosticItem, segmentLine, sortSelection } from "../Utils/EditorMath";
import type { EditorOverlayAnchor } from "../Utils/EditorOverlay";
import type { EditorHoverState } from "./HoverCard";

interface EditorLineProps {
  idx: number;
  lineText: string;
  isCurrent: boolean;
  tokens: number[];
  searchQuery: string;
  searchLineMatches: { char: number; length?: number }[];
  currentMatchIndex: number;
  searchMatches: { line: number; char: number; length?: number }[];
  lineDiags: DiagnosticItem[];
  selection: { start: { line: number; char: number }; end: { line: number; char: number } } | null;
  isDragging: boolean;
  setHoverTooltip: (val: EditorHoverState | null) => void;
  onMouseDown: (idx: number, e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave: () => void;
  onLanguageHover: (line: number, character: number, anchor: EditorOverlayAnchor) => void;
  textIndexAtPoint: (
    idx: number,
    element: HTMLButtonElement,
    clientX: number,
    clientY: number,
  ) => number;
  registerLineElement: (idx: number, element: HTMLButtonElement | null) => void;
  isComposing: boolean;
  compositionText: string;
  /** 合成预览插入点（当前行光标 char），用于把预览渲染到正确位置 */
  compositionChar: number;
  layout: EditorLayoutMetrics;
  isFoldedStart?: boolean;
  /** 真实折叠：该折叠块隐藏的行数（折叠胶囊计数） */
  foldedHiddenCount?: number;
  onToggleFold?: (line: number) => void;
  occurrences?: OccurrenceMatch[];
}

export const EditorLine = React.memo(function EditorLine({
  idx,
  lineText,
  isCurrent,
  tokens,
  searchQuery,
  searchLineMatches,
  currentMatchIndex,
  searchMatches,
  lineDiags,
  selection,
  isDragging,
  setHoverTooltip,
  onMouseDown,
  onMouseLeave,
  onLanguageHover,
  textIndexAtPoint,
  registerLineElement,
  isComposing,
  compositionText,
  compositionChar,
  layout,
  isFoldedStart,
  foldedHiddenCount,
  onToggleFold,
  occurrences,
}: EditorLineProps) {
  const lineRef = useRef<HTMLButtonElement | null>(null);
  const [renderedSelection, setRenderedSelection] = useState<{
    left: number;
    width: number;
  } | null>(null);

  const setLineRef = useCallback(
    (element: HTMLButtonElement | null) => {
      lineRef.current = element;
      registerLineElement(idx, element);
    },
    [idx, registerLineElement],
  );

  // 1. 独立计算本行的切分片段
  const segments = useMemo(() => {
    return segmentLine(
      lineText,
      tokens,
      searchQuery,
      searchLineMatches,
      currentMatchIndex,
      searchMatches,
      idx,
      lineDiags,
    );
  }, [
    lineText,
    tokens,
    searchQuery,
    searchLineMatches,
    currentMatchIndex,
    searchMatches,
    idx,
    lineDiags,
  ]);

  // 2. 独立计算选区高亮层（带依赖数组：无关渲染不再触发 DOM 测量）
  useLayoutEffect(() => {
    if (!selection || !lineRef.current) {
      setRenderedSelection(null);
      return;
    }
    const { start, end } = sortSelection(selection);
    if (idx < start.line || idx > end.line) {
      setRenderedSelection(null);
      return;
    }
    const startChar = idx === start.line ? start.char : 0;
    const endChar = idx === end.line ? end.char : lineText.length;
    const next = measureRenderedEditorRange(lineRef.current, startChar, endChar);
    setRenderedSelection((current) => {
      if (!next) return null;
      if (current && current.left === next.left && current.width === next.width) return current;
      return next;
    });
  }, [selection, idx, lineText]);

  const selectionLayer = useMemo(() => {
    if (!selection) return null;
    const { start, end } = sortSelection(selection);
    if (idx >= start.line && idx <= end.line) {
      const isStartLine = idx === start.line;
      const isEndLine = idx === end.line;

      const startChar = isStartLine ? start.char : 0;
      const endChar = isEndLine ? end.char : lineText.length;

      const prefixWidth =
        renderedSelection?.left ??
        measureEditorText(lineText.substring(0, startChar), layout) + layout.contentInsetX;
      const selectedWidth = isEndLine
        ? (renderedSelection?.width ??
          measureEditorText(lineText.substring(startChar, endChar), layout))
        : undefined;

      return (
        <div
          className="absolute top-0 bottom-0 bg-[var(--EditorSelectionBg)] pointer-events-none z-0"
          style={{
            left: `${prefixWidth}px`,
            width: isEndLine ? `${selectedWidth}px` : `calc(100% - ${prefixWidth}px)`,
          }}
        />
      );
    }
    return null;
  }, [selection, idx, lineText, layout, renderedSelection]);

  // 3. 缩进引导线计算
  const indentGuides = useMemo(() => {
    const leadingSpaces = lineText.search(/\S/);
    if (leadingSpaces <= 0) return null;
    const count = Math.floor(leadingSpaces / layout.tabSize);
    const guides = [];
    const spaceWidth = measureEditorText(" ", layout);
    for (let i = 1; i <= count; i++) {
      const left = layout.contentInsetX + i * layout.tabSize * spaceWidth;
      guides.push(
        <span
          key={`guide-${i}`}
          className="absolute top-0 bottom-0 border-l border-[var(--border-subtle)]/40 pointer-events-none"
          style={{ left: `${left}px` }}
        />,
      );
    }
    return guides;
  }, [lineText, layout]);

  // 4. 处理鼠标事件与诊断提示
  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!isDragging) {
      const charIndex = textIndexAtPoint(idx, e.currentTarget, e.clientX, e.clientY);
      const lineRect = e.currentTarget.getBoundingClientRect();
      const diag = lineDiags.find(
        (d) => charIndex >= d.range.start.character && charIndex <= d.range.end.character,
      );
      if (diag) {
        const anchor = measureRenderedEditorAnchor(
          e.currentTarget,
          diag.range.start.character,
          Math.max(diag.range.start.character + 1, diag.range.end.character),
        );
        const fallbackLeft =
          lineRect.left +
          layout.contentInsetX +
          measureEditorText(lineText.slice(0, diag.range.start.character), layout);
        setHoverTooltip({
          anchor: anchor ?? {
            left: fallbackLeft,
            right: fallbackLeft,
            top: lineRect.top,
            bottom: lineRect.bottom,
          },
          title: "诊断",
          source: diag.source,
          text: diag.message,
          tone: diag.severity === 1 ? "error" : "warning",
        });
      } else {
        const character = lineText[charIndex];
        if (!character || /\s/.test(character)) {
          setHoverTooltip(null);
          return;
        }
        let symbolStart = charIndex;
        while (symbolStart > 0 && /[\p{L}\p{N}_$]/u.test(lineText[symbolStart - 1])) {
          symbolStart--;
        }
        let symbolEnd = charIndex + 1;
        while (symbolEnd < lineText.length && /[\p{L}\p{N}_$]/u.test(lineText[symbolEnd])) {
          symbolEnd++;
        }
        const fallbackLeft =
          lineRect.left +
          layout.contentInsetX +
          measureEditorText(lineText.slice(0, symbolStart), layout);
        onLanguageHover(
          idx,
          symbolStart,
          measureRenderedEditorAnchor(e.currentTarget, symbolStart, symbolEnd) ?? {
            left: fallbackLeft,
            right: fallbackLeft,
            top: lineRect.top,
            bottom: lineRect.bottom,
          },
        );
      }
    }
  };

  return (
    <button
      type="button"
      ref={setLineRef}
      data-line={idx}
      tabIndex={-1}
      aria-hidden="true"
      onMouseDown={(e) => onMouseDown(idx, e)}
      onMouseMove={handleMouseMove}
      onMouseLeave={onMouseLeave}
      className={`editor-line relative block w-full border-0 bg-transparent text-left select-none cursor-text font-mono text-[var(--color-text-primary)] whitespace-pre transition-colors duration-100 ${
        isCurrent
          ? "bg-[var(--EditorActiveLineBg)] shadow-[inset_0_1px_0_var(--EditorActiveLineBorder),_inset_0_-1px_0_var(--EditorActiveLineBorder)]"
          : ""
      }`}
      style={{
        fontFamily: layout.fontFamily,
        fontSize: `${layout.fontSize}px`,
        height: `${layout.lineHeight}px`,
        lineHeight: `${layout.lineHeight}px`,
        paddingInline: `${layout.contentInsetX}px`,
        tabSize: layout.tabSize,
      }}
    >
      {indentGuides}
      {selectionLayer}

      {/* 相同标识符 Occurrence 微高亮 */}
      {occurrences
        ?.filter((occ) => occ.line === idx)
        .map((occ) => {
          const left =
            layout.contentInsetX + measureEditorText(lineText.substring(0, occ.startChar), layout);
          const width = measureEditorText(lineText.substring(occ.startChar, occ.endChar), layout);
          return (
            <span
              key={`occ-${occ.startChar}-${occ.endChar}`}
              className="absolute top-0 bottom-0 hl-occurrence pointer-events-none z-0"
              style={{ left: `${left}px`, width: `${width}px` }}
            />
          );
        })}

      <span data-editor-text-content className="relative z-10">
        {segments.length === 0 ? (
          <span>{lineText || "\n"}</span>
        ) : (
          segments.map((seg) => (
            <span key={`${seg.start}-${seg.end}`} className={seg.classes.join(" ")}>
              {lineText.substring(seg.start, seg.end)}
            </span>
          ))
        )}
      </span>

      {/* 折叠省略号占位符 */}
      {isFoldedStart && onToggleFold && (
        <FoldedPlaceholder onClick={() => onToggleFold(idx)} hiddenCount={foldedHiddenCount} />
      )}

      {isCurrent && isComposing && compositionText && (
        <span
          data-editor-composition
          className="absolute top-0 underline decoration-dotted opacity-75 text-[var(--color-text-highlight)] ime-temp pointer-events-none z-20"
          style={{
            left: `${layout.contentInsetX + measureEditorText(lineText.substring(0, compositionChar), layout)}px`,
            height: `${layout.lineHeight}px`,
            lineHeight: `${layout.lineHeight}px`,
          }}
        >
          {compositionText}
        </span>
      )}
    </button>
  );
});
