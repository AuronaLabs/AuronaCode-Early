import { type RefObject, useEffect } from "react";
import {
  type EditorLayoutMetrics,
  readEditorLayoutMetrics,
  sameEditorLayout,
} from "../Utils/EditorLayoutMetrics";

export interface UseExternalSyncParams {
  value: string;
  externalContent?: { content: string; nonce: number } | null;
  revealLine?: number;
  totalLines: number;
  path?: string;
  onRevealHandled?: (path: string, line: number) => void;
  setDocumentLines: (lines: string[]) => void;
  setTotalLines: (total: number) => void;
  updateMaxLineLength: (lines: string[]) => void;
  syncExternal: (content: string) => void;
  setCursor: (cursor: { line: number; char: number }) => void;
  setSelection: (selection: null) => void;
  scrollToLine: (line: number) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  setLayout: React.Dispatch<React.SetStateAction<EditorLayoutMetrics>>;
}

/** 外部内容同步（value/externalContent）、revealLine 定位与容器布局测量。 */
export function useExternalSync({
  value,
  externalContent,
  revealLine,
  totalLines,
  path,
  onRevealHandled,
  setDocumentLines,
  setTotalLines,
  updateMaxLineLength,
  syncExternal,
  setCursor,
  setSelection,
  scrollToLine,
  containerRef,
  setLayout,
}: UseExternalSyncParams) {
  useEffect(() => {
    const lines = value.split("\n");
    setDocumentLines(lines);
    setTotalLines(lines.length);
    updateMaxLineLength(lines);
    syncExternal(value);
  }, [value, syncExternal, updateMaxLineLength, setTotalLines, setDocumentLines]);

  useEffect(() => {
    if (!externalContent) return;
    const lines = externalContent.content.split("\n");
    setDocumentLines(lines);
    setTotalLines(lines.length);
    updateMaxLineLength(lines);
    syncExternal(externalContent.content);
  }, [externalContent, syncExternal, updateMaxLineLength, setDocumentLines, setTotalLines]);

  useEffect(() => {
    if (revealLine !== undefined && revealLine > 0) {
      const targetLine = Math.min(revealLine - 1, totalLines - 1);
      setCursor({ line: targetLine, char: 0 });
      setSelection(null);
      scrollToLine(targetLine);
      if (path && onRevealHandled) onRevealHandled(path, revealLine);
    }
  }, [revealLine, totalLines, path, onRevealHandled, scrollToLine, setSelection, setCursor]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateLayout = () => {
      const nextLayout = readEditorLayoutMetrics(container);
      setLayout((prev) => (sameEditorLayout(prev, nextLayout) ? prev : nextLayout));
    };
    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(container);
    return () => observer.disconnect();
  }, [setLayout, containerRef.current]);
}
