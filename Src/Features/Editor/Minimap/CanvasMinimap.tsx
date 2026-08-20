import React, { useState } from "react";
import type { MinimapDecoration } from "./MinimapDecorations";
import { useMinimapRenderer } from "./useMinimapRenderer";

export interface CanvasMinimapProps {
  documentLines: string[];
  linesTokens: number[][];
  totalLines: number;
  scrollTop: number;
  viewportHeight: number;
  lineHeight: number;
  width?: number;
  decorations: MinimapDecoration[];
  onScrollTo: (targetScrollTop: number) => void;
}

export const CanvasMinimap = React.memo(function CanvasMinimap({
  documentLines,
  linesTokens,
  totalLines,
  scrollTop,
  viewportHeight,
  lineHeight,
  width = 64,
  decorations,
  onScrollTo,
}: CanvasMinimapProps) {
  const [hoveredLine, setHoveredLine] = useState<{ line: number; text: string; y: number } | null>(
    null,
  );

  const { canvasRef, sliderTop, sliderHeight, handleMouseDown } = useMinimapRenderer({
    documentLines,
    linesTokens,
    totalLines,
    scrollTop,
    viewportHeight,
    lineHeight,
    minimapWidth: width,
    decorations,
    onScrollTo,
  });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const lineIndex = Math.floor(relativeY / 2); // 2px 每行
    if (lineIndex >= 0 && lineIndex < documentLines.length) {
      setHoveredLine({
        line: lineIndex + 1,
        text: documentLines[lineIndex] || "",
        y: relativeY,
      });
    } else {
      setHoveredLine(null);
    }
  };

  return (
    <section
      aria-label="Code Minimap"
      className="relative shrink-0 h-full border-l border-[var(--border-subtle)] bg-[var(--material-surface)]/20 select-none overflow-hidden group/minimap cursor-pointer"
      style={{ width: `${width}px` }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredLine(null)}
    >
      {/* 2D Canvas 像素渲染层 */}
      <canvas ref={canvasRef} className="absolute left-0 top-0 pointer-events-none" />

      {/* 半透明视口滑动窗 (Viewport Slider) */}
      <div
        className="absolute left-0 w-full bg-[var(--color-accent)]/10 border-y border-[var(--color-accent)]/30 backdrop-blur-[1px] hover:bg-[var(--color-accent)]/15 transition-colors pointer-events-none"
        style={{
          top: `${sliderTop}px`,
          height: `${sliderHeight}px`,
        }}
      />

      {/* 悬浮代码预览 Tooltip */}
      {hoveredLine && (
        <div
          className="absolute right-full mr-2 z-50 pointer-events-none px-2.5 py-1 rounded-lg border border-[var(--border-overlay)] bg-[var(--material-overlay)] backdrop-blur-[var(--glass-blur-floating)] shadow-lg text-[11px] font-mono text-[var(--color-text-highlight)] max-w-sm truncate whitespace-pre"
          style={{
            top: `${Math.max(4, Math.min(viewportHeight - 32, hoveredLine.y - 12))}px`,
          }}
        >
          <span className="text-[var(--color-text-muted)] mr-2 font-bold">{hoveredLine.line}</span>
          {hoveredLine.text.trim() || <span className="opacity-40">&lt;empty&gt;</span>}
        </div>
      )}
    </section>
  );
});
