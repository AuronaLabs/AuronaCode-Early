import { useCallback, useEffect, useRef } from "react";
import { pointerSelectionDecision } from "../Utils/EditorInteraction";
import type { EditorLayoutMetrics } from "../Utils/EditorLayoutMetrics";

export interface TextPosition {
  line: number;
  char: number;
}

export interface SelectionRange {
  start: TextPosition;
  end: TextPosition;
}

export interface UseEditorPointerSelectionOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  lineElementsRef: React.RefObject<Map<number, HTMLButtonElement>>;
  documentLines: string[];
  totalLines: number;
  layout: EditorLayoutMetrics;
  selection: SelectionRange | null;
  setSelection: React.Dispatch<React.SetStateAction<SelectionRange | null>>;
  setCursor: React.Dispatch<React.SetStateAction<TextPosition>>;
  textIndexAtPoint: (
    lineIndex: number,
    lineElement: HTMLButtonElement,
    clientX: number,
    clientY: number,
  ) => number;
  minTextLengthIndex: (lineText: string, targetX: number) => number;
  findWordBoundaries: (lineText: string, charIndex: number) => { start: number; end: number };
  onPointerStateChange?: () => void;
}

/**
 * 封装编辑器鼠标指针选区交互：点击、双击选词、三击选行、拖拽框选与边缘自动滚动
 */
export function useEditorPointerSelection({
  containerRef,
  textareaRef,
  lineElementsRef,
  documentLines,
  totalLines,
  layout,
  selection,
  setSelection,
  setCursor,
  textIndexAtPoint,
  minTextLengthIndex,
  findWordBoundaries,
  onPointerStateChange,
}: UseEditorPointerSelectionOptions) {
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<TextPosition | null>(null);

  const handleLineMouseDown = useCallback(
    (lineIndex: number, e: React.MouseEvent<HTMLButtonElement>) => {
      const lineEl = e.currentTarget;
      const charIndex = textIndexAtPoint(lineIndex, lineEl, e.clientX, e.clientY);
      const pos = { line: lineIndex, char: charIndex };

      const pointerDecision = pointerSelectionDecision(e.button, pos, selection);
      if (pointerDecision.kind === "preserve-selection") {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        onPointerStateChange?.();
        return;
      }

      // 支持三击选中整行
      if (e.button === 0 && e.detail === 3) {
        const lineLen = (documentLines[lineIndex] || "").length;
        setSelection({
          start: { line: lineIndex, char: 0 },
          end: { line: lineIndex, char: lineLen },
        });
        setCursor({ line: lineIndex, char: lineLen });
        isDraggingRef.current = false;
        return;
      }

      // 支持双击选中当前单词
      if (e.button === 0 && e.detail === 2) {
        const lineText = documentLines[lineIndex] || "";
        const { start: wordStart, end: wordEnd } = findWordBoundaries(lineText, charIndex);
        const selStart = { line: lineIndex, char: wordStart };
        const selEnd = { line: lineIndex, char: wordEnd };
        setSelection({ start: selStart, end: selEnd });
        setCursor(selEnd);
        isDraggingRef.current = false;
        return;
      }

      // 常规点击/开启拖拽选中
      setCursor(pointerDecision.position);
      isDraggingRef.current = pointerDecision.beginDrag;
      dragStartRef.current = pointerDecision.beginDrag ? pointerDecision.position : null;
      setSelection(
        pointerDecision.beginDrag
          ? { start: pointerDecision.position, end: pointerDecision.position }
          : null,
      );

      onPointerStateChange?.();
      if (e.button === 0) {
        textareaRef.current?.focus();
        e.preventDefault();
      }
    },
    [
      documentLines,
      findWordBoundaries,
      onPointerStateChange,
      selection,
      setCursor,
      setSelection,
      textIndexAtPoint,
      textareaRef,
    ],
  );

  // 全局 mousemove：鼠标拖出编辑行时自动更新选区，并触发视口边界自动滚动
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const relativeX = e.clientX - rect.left;

      // 视口边界拖动触发自动滚动
      const scrollThreshold = 32;
      const scrollSpeed = 6;
      if (relativeY < scrollThreshold) {
        container.scrollTop -= scrollSpeed;
      } else if (relativeY > rect.height - scrollThreshold) {
        container.scrollTop += scrollSpeed;
      }

      const currentScrollTop = container.scrollTop;
      const currentScrollLeft = container.scrollLeft;

      const y = relativeY + currentScrollTop;
      const lineIndex = Math.max(
        0,
        Math.min(
          totalLines - 1,
          Math.floor(Math.max(0, y - layout.contentInsetTop) / layout.lineHeight),
        ),
      );

      const lineElement = lineElementsRef.current.get(lineIndex);
      const charIndex = lineElement
        ? textIndexAtPoint(lineIndex, lineElement, e.clientX, e.clientY)
        : minTextLengthIndex(
            documentLines[lineIndex] || "",
            relativeX + currentScrollLeft - layout.contentInsetX,
          );

      const pos = { line: lineIndex, char: charIndex };
      setSelection({
        start: dragStartRef.current,
        end: pos,
      });
      setCursor(pos);
    };

    window.addEventListener("mousemove", handleGlobalMouseMove);
    return () => window.removeEventListener("mousemove", handleGlobalMouseMove);
  }, [
    containerRef,
    documentLines,
    layout,
    lineElementsRef,
    minTextLengthIndex,
    setCursor,
    setSelection,
    textIndexAtPoint,
    totalLines,
  ]);

  // 全局 mouseup：结束拖拽状态
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        setSelection((prev) => {
          if (prev && prev.start.line === prev.end.line && prev.start.char === prev.end.char) {
            return null;
          }
          return prev;
        });
      }
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, [setSelection]);

  return {
    isDraggingRef,
    dragStartRef,
    handleLineMouseDown,
  };
}
