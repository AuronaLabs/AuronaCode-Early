import React from "react";
import type { CursorPosition } from "./useMultiCursorOps";

export interface MultiCursorCaretLayerProps {
  primaryCursor: CursorPosition;
  extraCursors: CursorPosition[];
  lineHeight: number;
  charWidth: number;
  contentInsetX: number;
  contentInsetTop: number;
  isActive?: boolean;
}

export const MultiCursorCaretLayer = React.memo(function MultiCursorCaretLayer({
  primaryCursor,
  extraCursors,
  lineHeight,
  charWidth,
  contentInsetX,
  contentInsetTop,
  isActive = true,
}: MultiCursorCaretLayerProps) {
  if (!isActive) return null;

  const allCursors = [primaryCursor, ...extraCursors];

  return (
    <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
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
