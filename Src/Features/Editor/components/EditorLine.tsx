import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type EditorLayoutMetrics,
  measureEditorText,
  measureRenderedEditorRange,
} from "../Utils/EditorLayoutMetrics";
import { type DiagnosticItem, segmentLine, sortSelection } from "../Utils/EditorMath";

interface EditorLineProps {
  idx: number;
  lineText: string;
  isCurrent: boolean;
  tokens: number[];
  searchQuery: string;
  searchLineMatches: { char: number }[];
  currentMatchIndex: number;
  searchMatches: { line: number; char: number }[];
  lineDiags: DiagnosticItem[];
  selection: { start: { line: number; char: number }; end: { line: number; char: number } } | null;
  isDragging: boolean;
  setHoverTooltip: (val: { x: number; y: number; text: string } | null) => void;
  hoverTooltip: { x: number; y: number; text: string } | null;
  onMouseDown: (idx: number, e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave: () => void;
  textIndexAtPoint: (
    idx: number,
    element: HTMLButtonElement,
    clientX: number,
    clientY: number,
  ) => number;
  registerLineElement: (idx: number, element: HTMLButtonElement | null) => void;
  isComposing: boolean;
  compositionText: string;
  layout: EditorLayoutMetrics;
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
  hoverTooltip,
  onMouseDown,
  onMouseLeave,
  textIndexAtPoint,
  registerLineElement,
  isComposing,
  compositionText,
  layout,
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

  // 2. 独立计算选区高亮层
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
  });

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
          className="absolute top-0 bottom-0 bg-[var(--EditorSelectionBg,rgba(58,77,110,0.5))] pointer-events-none z-0"
          style={{
            left: `${prefixWidth}px`,
            width: isEndLine ? `${selectedWidth}px` : `calc(100% - ${prefixWidth}px)`,
          }}
        />
      );
    }
    return null;
  }, [selection, idx, lineText, layout, renderedSelection]);

  // 3. 处理鼠标事件与诊断提示
  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!isDragging) {
      const charIndex = textIndexAtPoint(idx, e.currentTarget, e.clientX, e.clientY);
      const diag = lineDiags.find(
        (d) => charIndex >= d.range.start.character && charIndex <= d.range.end.character,
      );
      if (diag) {
        setHoverTooltip({ x: e.clientX, y: e.clientY + 20, text: diag.message });
      } else if (hoverTooltip) {
        setHoverTooltip(null);
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
      className={`editor-line relative block w-full border-0 bg-transparent text-left select-none cursor-text font-mono text-[var(--TextPrimary)] whitespace-pre transition-colors duration-150 ${
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
      {selectionLayer}

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

      {isCurrent && isComposing && compositionText && (
        <span
          data-editor-composition
          className="underline decoration-dotted opacity-75 text-[var(--TextHighlight)] ime-temp"
        >
          {compositionText}
        </span>
      )}
    </button>
  );
});
