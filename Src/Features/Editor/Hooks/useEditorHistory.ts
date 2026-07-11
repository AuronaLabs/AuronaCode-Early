import { useState, useCallback, useRef, useEffect } from "react";

export function useEditorHistory(initialValue: string, onChange?: (value: string) => void) {
  const [history, setHistory] = useState<{ content: string; selectionStart: number }[]>([
    { content: initialValue, selectionStart: 0 },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyTimerRef = useRef<number | null>(null);
  const contentRef = useRef(initialValue);

  useEffect(() => {
    return () => {
      if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    };
  }, []);

  const pushHistory = useCallback(
    (newContent: string, cursor: number) => {
      setHistory((prev) => {
        const newHist = prev.slice(0, historyIndex + 1);
        newHist.push({ content: newContent, selectionStart: cursor });
        return newHist;
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [historyIndex],
  );

  const syncExternalValue = useCallback((value: string) => {
    if (value !== contentRef.current) {
      contentRef.current = value;
      setHistory([{ content: value, selectionStart: 0 }]);
      setHistoryIndex(0);
    }
  }, []);

  const undo = useCallback((): { content: string; selectionStart: number } | null => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      return prevState;
    }
    return null;
  }, [history, historyIndex]);

  const redo = useCallback((): { content: string; selectionStart: number } | null => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      return nextState;
    }
    return null;
  }, [history, historyIndex]);

  return {
    history,
    historyIndex,
    pushHistory,
    syncExternalValue,
    undo,
    redo,
    historyTimerRef,
    contentRef,
  };
}
