import { useCallback, useEffect, useRef } from "react";

type HistoryEntry = {
  content: string;
  selectionStart: number;
};

type EditOperation = {
  startUtf16: number;
  deletedText: string;
  insertedText: string;
  beforeSelection: number;
  afterSelection: number;
  timestamp: number;
};

const MAX_HISTORY_OPERATIONS = 400;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const TYPE_MERGE_WINDOW_MS = 500;

function operationBytes(operation: EditOperation) {
  return (operation.deletedText.length + operation.insertedText.length) * 2 + 48;
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

function diffText(
  previous: string,
  next: string,
): Pick<EditOperation, "startUtf16" | "deletedText" | "insertedText"> {
  let prefix = 0;
  const sharedLength = Math.min(previous.length, next.length);
  while (prefix < sharedLength && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  if (
    prefix > 0 &&
    (isLowSurrogate(previous.charCodeAt(prefix)) || isLowSurrogate(next.charCodeAt(prefix)))
  ) {
    prefix--;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > prefix &&
    nextEnd > prefix &&
    previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    previousEnd--;
    nextEnd--;
  }
  if (isLowSurrogate(previous.charCodeAt(previousEnd))) previousEnd--;
  if (isLowSurrogate(next.charCodeAt(nextEnd))) nextEnd--;

  return {
    startUtf16: prefix,
    deletedText: previous.slice(prefix, previousEnd),
    insertedText: next.slice(prefix, nextEnd),
  };
}

function applyOperation(content: string, operation: EditOperation, inverse: boolean) {
  const removedLength = inverse ? operation.insertedText.length : operation.deletedText.length;
  const insertedText = inverse ? operation.deletedText : operation.insertedText;
  return (
    content.slice(0, operation.startUtf16) +
    insertedText +
    content.slice(operation.startUtf16 + removedLength)
  );
}

export function useEditorHistory(initialValue: string) {
  const operationsRef = useRef<EditOperation[]>([]);
  const appliedCountRef = useRef(0);
  const currentContentRef = useRef(initialValue);
  const currentSelectionRef = useRef(0);
  const historyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    };
  }, []);

  const pushHistory = useCallback((content: string, selectionStart: number) => {
    const previousContent = currentContentRef.current;
    if (previousContent === content) {
      currentSelectionRef.current = selectionStart;
      return;
    }

    const difference = diffText(previousContent, content);
    const operation: EditOperation = {
      ...difference,
      beforeSelection: currentSelectionRef.current,
      afterSelection: selectionStart,
      timestamp: Date.now(),
    };
    const operations = operationsRef.current.slice(0, appliedCountRef.current);
    const previous = operations.at(-1);
    const canMergeTyping =
      previous !== undefined &&
      previous.deletedText.length === 0 &&
      operation.deletedText.length === 0 &&
      previous.startUtf16 + previous.insertedText.length === operation.startUtf16 &&
      operation.timestamp - previous.timestamp <= TYPE_MERGE_WINDOW_MS;

    if (canMergeTyping) {
      previous.insertedText += operation.insertedText;
      previous.afterSelection = operation.afterSelection;
      previous.timestamp = operation.timestamp;
    } else {
      operations.push(operation);
    }

    let retainedBytes = operations.reduce((total, item) => total + operationBytes(item), 0);
    while (operations.length > MAX_HISTORY_OPERATIONS || retainedBytes > MAX_HISTORY_BYTES) {
      const removed = operations.shift();
      if (!removed) break;
      retainedBytes -= operationBytes(removed);
    }
    operationsRef.current = operations;
    appliedCountRef.current = operations.length;
    currentContentRef.current = content;
    currentSelectionRef.current = selectionStart;
  }, []);

  const resetHistory = useCallback((content: string) => {
    operationsRef.current = [];
    appliedCountRef.current = 0;
    currentContentRef.current = content;
    currentSelectionRef.current = 0;
  }, []);

  const undo = useCallback((): HistoryEntry | null => {
    if (appliedCountRef.current === 0) return null;
    const operation = operationsRef.current[appliedCountRef.current - 1];
    const content = applyOperation(currentContentRef.current, operation, true);
    appliedCountRef.current--;
    currentContentRef.current = content;
    currentSelectionRef.current = operation.beforeSelection;
    return { content, selectionStart: operation.beforeSelection };
  }, []);

  const redo = useCallback((): HistoryEntry | null => {
    if (appliedCountRef.current >= operationsRef.current.length) return null;
    const operation = operationsRef.current[appliedCountRef.current];
    const content = applyOperation(currentContentRef.current, operation, false);
    appliedCountRef.current++;
    currentContentRef.current = content;
    currentSelectionRef.current = operation.afterSelection;
    return { content, selectionStart: operation.afterSelection };
  }, []);

  return { pushHistory, resetHistory, undo, redo, historyTimerRef };
}
