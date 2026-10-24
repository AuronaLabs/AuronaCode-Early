import { type RefObject, useLayoutEffect, useRef } from "react";
import {
  type EditorLayoutMetrics,
  measureEditorText,
  measureRenderedEditorRange,
} from "../Utils/EditorLayoutMetrics";
import { sortSelection } from "../Utils/EditorMath";
import type { CursorPosition, ExtraCursor } from "./useMultiCursorOps";

export interface MultiCursorCaretLayerProps {
  primaryCursor: CursorPosition;
  extras: ExtraCursor[];
  documentLines: string[];
  lineElementsRef: RefObject<Map<number, HTMLButtonElement>>;
  layout: EditorLayoutMetrics;
  isActive?: boolean;
  toVisualLine?: (line: number) => number;
  smoothCaret?: boolean;
}

export function MultiCursorCaretLayer({
  primaryCursor,
  extras,
  documentLines,
  lineElementsRef,
  layout,
  isActive = true,
  toVisualLine = (line) => line,
  smoothCaret = false,
}: MultiCursorCaretLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  // Measure after virtual rows commit, including token/font changes and scrolling.
  // The same DOM ranges position both EditorLine selections and these carets.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    for (const marker of layer.querySelectorAll<HTMLElement>("[data-caret-line]")) {
      const line = Number(marker.dataset.caretLine);
      const start = Number(marker.dataset.caretStart);
      const end = Number(marker.dataset.caretEnd ?? start);
      const element = lineElementsRef.current.get(line);
      const text = documentLines[line] ?? "";
      const measured = element ? measureRenderedEditorRange(element, start, end) : null;
      const left =
        measured?.left ?? layout.contentInsetX + measureEditorText(text.slice(0, start), layout);
      marker.style.left = `${left}px`;
      if (marker.dataset.caretEnd !== undefined) {
        marker.style.width = `${Math.max(0, measured?.width ?? measureEditorText(text.slice(0, end), layout) - measureEditorText(text.slice(0, start), layout))}px`;
      }
    }
  });

  if (!isActive) return null;
  const allCursors = [primaryCursor, ...extras.map((item) => item.cursor)];
  return (
    <div ref={layerRef} className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
      {extras.map((item) => {
        if (!item.selection) return null;
        const { start, end } = sortSelection(item.selection);
        if (start.line !== end.line) return null;
        return (
          <div
            key={`extra-selection-${start.line}-${start.char}-${end.char}`}
            data-caret-line={start.line}
            data-caret-start={start.char}
            data-caret-end={end.char}
            className="absolute bg-[var(--EditorSelectionBg)] pointer-events-none"
            style={{
              top: layout.contentInsetTop + toVisualLine(start.line) * layout.lineHeight,
              height: layout.lineHeight,
            }}
          />
        );
      })}
      {allCursors.map((cursor, index) => (
        <div
          key={index === 0 ? "primary" : `extra-${cursor.line}-${cursor.char}`}
          data-caret-line={cursor.line}
          data-caret-start={cursor.char}
          className={`absolute w-[2px] bg-[var(--color-accent)] editor-caret ease-out ${smoothCaret ? "transition-[left,top] duration-75" : ""}`}
          style={{
            top: layout.contentInsetTop + toVisualLine(cursor.line) * layout.lineHeight,
            height: layout.lineHeight,
          }}
        />
      ))}
    </div>
  );
}
