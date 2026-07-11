import React, { useMemo } from "react";
import { type DiagnosticItem, segmentLine, sortSelection } from "../Utils/EditorMath";
import { measureTextWidthFast } from "../Utils/TextMeasurement";

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
  onMouseDown: (idx: number, e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
  minTextLengthIndex: (text: string, x: number) => number;
  isComposing: boolean;
  compositionText: string;
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
  minTextLengthIndex,
  isComposing,
  compositionText,
}: EditorLineProps) {
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
  const selectionLayer = useMemo(() => {
    if (!selection) return null;
    const { start, end } = sortSelection(selection);
    if (idx >= start.line && idx <= end.line) {
      const isStartLine = idx === start.line;
      const isEndLine = idx === end.line;

      const startChar = isStartLine ? start.char : 0;
      const endChar = isEndLine ? end.char : lineText.length;

      const prefixWidth = measureTextWidthFast(lineText.substring(0, startChar));
      const selectedWidth = isEndLine
        ? measureTextWidthFast(lineText.substring(startChar, endChar))
        : undefined;

      return (
        <div
          className="absolute top-0 bottom-0 bg-[var(--EditorSelectionBg,rgba(58,77,110,0.5))] pointer-events-none z-0"
          style={{
            left: `${prefixWidth + 16}px`,
            width: isEndLine ? `${selectedWidth}px` : `calc(100% - ${prefixWidth + 16}px)`,
          }}
        />
      );
    }
    return null;
  }, [selection, idx, lineText]);

  // 3. 处理鼠标事件与诊断提示
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const charIndex = Math.max(0, minTextLengthIndex(lineText, clickX - 16));
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
    <div
      data-line={idx}
      role="textbox"
      tabIndex={-1}
      onMouseDown={(e) => onMouseDown(idx, e)}
      onMouseMove={handleMouseMove}
      onMouseLeave={onMouseLeave}
      className={`editor-line relative select-none cursor-text px-4 font-mono text-[14px] h-[22px] leading-[22px] text-[var(--TextPrimary)] whitespace-pre transition-colors duration-150 ${
        isCurrent
          ? "bg-[var(--EditorActiveLineBg)] shadow-[inset_0_1px_0_var(--EditorActiveLineBorder),_inset_0_-1px_0_var(--EditorActiveLineBorder)]"
          : ""
      }`}
      style={{ fontFamily: "var(--EditorFontFamily)" }}
    >
      {selectionLayer}

      <div className="relative z-10 pointer-events-none">
        {segments.length === 0 ? (
          <span>{lineText || "\n"}</span>
        ) : (
          segments.map((seg) => (
            <span key={`${seg.start}-${seg.end}`} className={seg.classes.join(" ")}>
              {lineText.substring(seg.start, seg.end)}
            </span>
          ))
        )}
      </div>

      {isCurrent && isComposing && compositionText && (
        <span className="underline decoration-dotted opacity-75 text-[var(--TextHighlight)] ime-temp">
          {compositionText}
        </span>
      )}
    </div>
  );
});
