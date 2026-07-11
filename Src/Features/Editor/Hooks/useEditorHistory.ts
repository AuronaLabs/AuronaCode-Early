import { useCallback, useEffect, useRef } from "react";

type HistoryEntry = {
  content: string;
  selectionStart: number;
};

const MAX_HISTORY_ENTRIES = 500;

export function useEditorHistory(initialValue: string) {
  const historyRef = useRef<HistoryEntry[]>([{ content: initialValue, selectionStart: 0 }]);
  const historyIndexRef = useRef(0);
  const historyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    };
  }, []);

  const pushHistory = useCallback((content: string, selectionStart: number) => {
    const currentIndex = historyIndexRef.current;
    const nextHistory = historyRef.current.slice(0, currentIndex + 1);
    const previous = nextHistory[nextHistory.length - 1];

    if (previous?.content === content) {
      nextHistory[nextHistory.length - 1] = { content, selectionStart };
    } else {
      nextHistory.push({ content, selectionStart });
    }

    const boundedHistory = nextHistory.slice(-MAX_HISTORY_ENTRIES);
    historyRef.current = boundedHistory;
    historyIndexRef.current = boundedHistory.length - 1;
  }, []);

  const resetHistory = useCallback((content: string) => {
    historyRef.current = [{ content, selectionStart: 0 }];
    historyIndexRef.current = 0;
  }, []);

  const undo = useCallback((): HistoryEntry | null => {
    if (historyIndexRef.current === 0) return null;

    historyIndexRef.current -= 1;
    return historyRef.current[historyIndexRef.current] ?? null;
  }, []);

  const redo = useCallback((): HistoryEntry | null => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return null;

    historyIndexRef.current += 1;
    return historyRef.current[historyIndexRef.current] ?? null;
  }, []);

  return { pushHistory, resetHistory, undo, redo, historyTimerRef };
}
