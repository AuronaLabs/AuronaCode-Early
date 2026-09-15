import React from "react";
import { sortSelection } from "../Utils/EditorMath";
import type { CursorPosition, ExtraCursor } from "./useMultiCursorOps";

export interface MultiCursorCaretLayerProps {
  primaryCursor: CursorPosition;
  extras: ExtraCursor[];
  lineHeight: number;
  charWidth: number;
  contentInsetX: number;
  contentInsetTop: number;
  isActive?: boolean;
}

export const MultiCursorCaretLayer = React.memo(function MultiCursorCaretLayer({
  primaryCursor,
  extras,
  lineHeight,
  charWidth,
  contentInsetX,
  contentInsetTop,
  isActive = true,
}: MultiCursorCaretLayerProps) {
  if (!isActive) return null;

  const allCursors = [primaryCursor, ...extras.map((item) => item.cursor)];

  return (
    <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
      {extras.map((item) => {
        if (!item.selection) return null;
        const { start, end } = sortSelection(item.selection);
        // 第一版仅高亮单行选区（Ctrl+D 产生的词选区均为单行）
        if (start.line !== end.line) return null;
        const left = contentInsetX + start.char * charWidth;
        const width = Math.max(1, (end.char - start.char) * charWidth);
        return (
          <div
            key={`extra-selection-${start.line}-${start.char}-${end.char}`}
            className="absolute bg-[var(--EditorSelectionBg)] pointer-events-none"
            style={{
              left: `${left}px`,
              top: `${contentInsetTop + start.line * lineHeight}px`,
              width: `${width}px`,
              height: `${lineHeight}px`,
            }}
          />
        );
      })}
      {allCursors.map((c) => {
        const x = contentInsetX + c.char * charWidth;
        const y = contentInsetTop + c.line * lineHeight;

        return (
          <div
            key={`caret-${c.line}-${c.char}`}
            className="absolute w-[2px] bg-[var(--color-accent)] editor-caret transition-all duration-75 ease-out"
            style={{
              left: `${x}px`,
              top: `${y}px`,
              height: `${lineHeight}px`,
            }}
          />
        );
      })}
    </div>
  );
});
