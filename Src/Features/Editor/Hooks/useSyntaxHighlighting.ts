import { useEffect, useMemo, useRef, useState } from "react";
import { DocumentService } from "../../../Core/DocumentService";

const LARGE_FILE_BYTES = 2 * 1024 * 1024;
const LARGE_FILE_LINES = 20_000;
const LARGE_FILE_OVERSCAN = 120;

interface SyntaxHighlightingOptions {
  documentLines: string[];
  language: string;
  path?: string;
  valueLength: number;
  totalLines: number;
  scrollTop: number;
  viewportHeight: number;
  contentInsetTop: number;
  lineHeight: number;
}

interface WorkerResult {
  id: string;
  tokens: number[][];
}

export function useSyntaxHighlighting({
  documentLines,
  language,
  path,
  valueLength,
  totalLines,
  scrollTop,
  viewportHeight,
  contentInsetTop,
  lineHeight,
}: SyntaxHighlightingOptions) {
  const [linesTokens, setLinesTokens] = useState<number[][]>([]);
  const [largeLineTokens, setLargeLineTokens] = useState<Map<number, number[]>>(() => new Map());
  const [workerReady, setWorkerReady] = useState(false);
  const highlightWorkerRef = useRef<Worker | null>(null);
  const requestSequenceRef = useRef(0);
  const latestHighlightIdRef = useRef("");
  const latestLargeHighlightRequestRef = useRef("");
  const largeCacheIdentityRef = useRef("");

  const visibleStartIndex = Math.max(
    0,
    Math.floor(Math.max(0, scrollTop - contentInsetTop) / lineHeight),
  );
  const visibleEndIndex = Math.min(
    totalLines,
    Math.ceil(Math.max(0, scrollTop - contentInsetTop + viewportHeight) / lineHeight),
  );
  const isLargeFileMode = totalLines > LARGE_FILE_LINES || valueLength > LARGE_FILE_BYTES;

  useEffect(() => {
    let disposed = false;
    let ownedWorker: Worker | null = null;

    void import("../Workers/highlight.worker?worker").then((workerModule) => {
      const worker = new workerModule.default();
      ownedWorker = worker;
      if (disposed) {
        worker.terminate();
        return;
      }
      highlightWorkerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (event.data.id === latestHighlightIdRef.current) {
          setLinesTokens((previous) => {
            const next = event.data.tokens;
            // 引用稳定化：未变化行的 token 数组复用旧引用，
            // 让 EditorLine 的 React.memo 在高亮刷新时也能命中（0.4.6 增量渲染）。
            if (previous.length !== next.length) return next;
            let changed = false;
            const merged = new Array<number[]>(next.length);
            for (let i = 0; i < next.length; i++) {
              const previousLine = previous[i];
              const nextLine = next[i];
              if (
                previousLine !== undefined &&
                previousLine.length === nextLine.length &&
                previousLine.every((value, index) => value === nextLine[index])
              ) {
                merged[i] = previousLine;
              } else {
                merged[i] = nextLine;
                changed = true;
              }
            }
            return changed ? merged : previous;
          });
        }
      };
      setWorkerReady(true);
    });

    return () => {
      disposed = true;
      ownedWorker?.terminate();
      if (highlightWorkerRef.current === ownedWorker) highlightWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!workerReady || isLargeFileMode) return;

    setLinesTokens((previous) => {
      if (previous.length === documentLines.length) return previous;
      const next = previous.slice(0, documentLines.length);
      while (next.length < documentLines.length) next.push([]);
      return next;
    });

    const timer = window.setTimeout(() => {
      const worker = highlightWorkerRef.current;
      if (!worker) return;
      const id = `document:${++requestSequenceRef.current}`;
      latestHighlightIdRef.current = id;
      worker.postMessage({
        id,
        fullText: documentLines.join("\n"),
        language,
        totalLines: documentLines.length,
      });
    }, 150);

    return () => window.clearTimeout(timer);
  }, [documentLines, isLargeFileMode, language, workerReady]);

  const largeCacheIdentity = `${language}\0${path ?? ""}`;
  useEffect(() => {
    if (largeCacheIdentityRef.current === largeCacheIdentity) return;
    largeCacheIdentityRef.current = largeCacheIdentity;
    setLargeLineTokens(new Map());
  }, [largeCacheIdentity]);

  useEffect(() => {
    if (!path || !isLargeFileMode) return;

    const startLine = Math.max(0, visibleStartIndex - LARGE_FILE_OVERSCAN);
    const endLine = Math.min(totalLines, visibleEndIndex + LARGE_FILE_OVERSCAN);
    const requestId = `range:${++requestSequenceRef.current}`;
    latestLargeHighlightRequestRef.current = requestId;
    const timer = window.setTimeout(() => {
      DocumentService.getLines(path, startLine, endLine)
        .then((response) => {
          if (latestLargeHighlightRequestRef.current !== requestId) return;
          setLargeLineTokens((previous) => {
            const next = new Map(previous);
            for (let index = 0; index < response.lines.length; index++) {
              next.set(startLine + index, response.lines[index].tokens);
            }
            const retainStart = Math.max(0, startLine - LARGE_FILE_OVERSCAN * 4);
            const retainEnd = Math.min(totalLines, endLine + LARGE_FILE_OVERSCAN * 4);
            for (const lineIndex of next.keys()) {
              if (lineIndex < retainStart || lineIndex >= retainEnd) next.delete(lineIndex);
            }
            return next;
          });
        })
        .catch(console.error);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [isLargeFileMode, path, totalLines, visibleEndIndex, visibleStartIndex]);

  return useMemo(
    () => ({
      linesTokens,
      largeLineTokens,
      visibleStartIndex,
      visibleEndIndex,
      isLargeFileMode,
    }),
    [isLargeFileMode, largeLineTokens, linesTokens, visibleEndIndex, visibleStartIndex],
  );
}
