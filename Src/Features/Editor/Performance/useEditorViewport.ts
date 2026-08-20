import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorLayoutMetrics } from "../Utils/EditorLayoutMetrics";

export interface UseEditorViewportProps {
  totalLines: number;
  layout: EditorLayoutMetrics;
  containerRef: React.RefObject<HTMLDivElement | null>;
  overscan?: number;
}

export interface EditorViewportState {
  scrollTop: number;
  scrollLeft: number;
  viewportHeight: number;
  viewportWidth: number;
  visibleStartIndex: number;
  visibleEndIndex: number;
  gutterOffsetY: number;
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  scrollToLine: (lineIndex: number) => void;
}

export function useEditorViewport({
  totalLines,
  layout,
  containerRef,
  overscan = 5,
}: UseEditorViewportProps): EditorViewportState {
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);
  const [viewportWidth, setViewportWidth] = useState(800);

  const rafIdRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<{ top: number; left: number } | null>(null);

  // 1. 视口尺寸监听
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      setViewportHeight(container.clientHeight || 500);
      setViewportWidth(container.clientWidth || 800);
    };
    updateSize();

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(container);
      return () => resizeObserver.disconnect();
    }
  }, [containerRef]);

  // 2. 硬件 RAF 滚动节流合并
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    pendingScrollRef.current = {
      top: target.scrollTop,
      left: target.scrollLeft,
    };

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (pendingScrollRef.current) {
          setScrollTop(pendingScrollRef.current.top);
          setScrollLeft(pendingScrollRef.current.left);
          pendingScrollRef.current = null;
        }
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // 3. 虚拟行视口与缓冲行计算
  const rawStartIndex = Math.floor(
    Math.max(0, scrollTop - layout.contentInsetTop) / layout.lineHeight,
  );
  const rawEndIndex = Math.ceil(
    Math.max(0, scrollTop - layout.contentInsetTop + viewportHeight) / layout.lineHeight,
  );

  const visibleStartIndex = Math.max(0, rawStartIndex - overscan);
  const visibleEndIndex = Math.min(totalLines, rawEndIndex + overscan);

  // Gutter 偏移量
  const gutterOffsetY = visibleStartIndex * layout.lineHeight;

  // 4. 滚动到指定行
  const scrollToLine = useCallback(
    (lineIndex: number) => {
      const container = containerRef.current;
      if (!container) return;

      const targetY = layout.contentInsetTop + lineIndex * layout.lineHeight;
      const currentScrollTop = container.scrollTop;
      const clientHeight = container.clientHeight;

      if (targetY < currentScrollTop) {
        container.scrollTop = targetY;
      } else if (targetY + layout.lineHeight > currentScrollTop + clientHeight) {
        container.scrollTop = targetY + layout.lineHeight - clientHeight;
      }
    },
    [containerRef, layout.contentInsetTop, layout.lineHeight],
  );

  return {
    scrollTop,
    scrollLeft,
    viewportHeight,
    viewportWidth,
    visibleStartIndex,
    visibleEndIndex,
    gutterOffsetY,
    handleScroll,
    scrollToLine,
  };
}
