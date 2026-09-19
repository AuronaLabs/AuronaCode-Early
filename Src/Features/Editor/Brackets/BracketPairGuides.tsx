import React from "react";
import type { BracketPair } from "./useBracketMatching";

export interface BracketPairGuidesProps {
  activePair: BracketPair | null;
  lineHeight: number;
  charWidth: number;
  contentInsetX: number;
  contentInsetTop: number;
  /** 真实行 → 可视行转换（真实折叠启用时由引擎传入） */
  toVisualLine?: (line: number) => number;
}

export const BracketPairGuides = React.memo(function BracketPairGuides({
  activePair,
  lineHeight,
  charWidth,
  contentInsetX,
  contentInsetTop,
  toVisualLine,
}: BracketPairGuidesProps) {
  if (!activePair || activePair.open.line === activePair.close.line) {
    return null;
  }

  const toVisual = toVisualLine ?? ((line: number) => line);
  // 垂直引导线 X 轴位于开括号所在列
  const x = contentInsetX + activePair.open.char * charWidth + charWidth / 2;
  const startY = contentInsetTop + (toVisual(activePair.open.line) + 1) * lineHeight;
  const endY = contentInsetTop + toVisual(activePair.close.line) * lineHeight;
  const height = Math.max(0, endY - startY);

  if (height <= 0) return null;

  return (
    <div
      className="absolute border-l border-dashed border-[var(--color-accent)]/50 pointer-events-none z-10"
      style={{
        left: `${x}px`,
        top: `${startY}px`,
        height: `${height}px`,
      }}
    />
  );
});
