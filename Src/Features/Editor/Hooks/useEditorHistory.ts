import { useCallback, useEffect, useRef } from "react";

type HistoryEntry = {
  content: string;
  selectionStart: number;
};

type SingleOperation = {
  kind: "single";
  startUtf16: number;
  deletedText: string;
  insertedText: string;
  beforeSelection: number;
  afterSelection: number;
  timestamp: number;
};

/** 多光标批量编辑：子操作按顺序应用坐标（每个子操作基于前一子操作应用后的内容） */
type CompositeOperation = {
  kind: "composite";
  operations: SingleOperation[];
  beforeSelection: number;
  afterSelection: number;
  timestamp: number;
};

type EditOperation = SingleOperation | CompositeOperation;

const MAX_HISTORY_OPERATIONS = 400;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const TYPE_MERGE_WINDOW_MS = 500;

function operationBytes(operation: EditOperation) {
  if (operation.kind === "composite") {
    return (
      operation.operations.reduce(
        (total, item) => total + (item.deletedText.length + item.insertedText.length) * 2,
        0,
      ) + 64
    );
  }
  return (operation.deletedText.length + operation.insertedText.length) * 2 + 48;
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** 计算两个文本的单连续差异区间（前后缀去除后中间即为完整差异），用于撤销栈与精确写盘 */
export function diffText(
  previous: string,
  next: string,
): Pick<SingleOperation, "startUtf16" | "deletedText" | "insertedText"> {
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

function applyOperation(content: string, operation: EditOperation, inverse: boolean): string {
  if (operation.kind === "composite") {
    // 撤销逆序回放子操作，重做顺序回放；子操作坐标基于"前序子操作应用后"的内容
    const ordered = inverse ? [...operation.operations].reverse() : operation.operations;
    return ordered.reduce((acc, item) => applyOperation(acc, item, inverse), content);
  }
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

  const trimAndStore = useCallback((operations: EditOperation[]) => {
    let retainedBytes = operations.reduce((total, item) => total + operationBytes(item), 0);
    while (operations.length > MAX_HISTORY_OPERATIONS || retainedBytes > MAX_HISTORY_BYTES) {
      const removed = operations.shift();
      if (!removed) break;
      retainedBytes -= operationBytes(removed);
    }
    operationsRef.current = operations;
    appliedCountRef.current = operations.length;
  }, []);

  const pushHistory = useCallback((content: string, selectionStart: number) => {
    const previousContent = currentContentRef.current;
    if (previousContent === content) {
      currentSelectionRef.current = selectionStart;
      return;
    }

    const difference = diffText(previousContent, content);
    const operation: SingleOperation = {
      kind: "single",
      ...difference,
      beforeSelection: currentSelectionRef.current,
      afterSelection: selectionStart,
      timestamp: Date.now(),
    };
    const operations = operationsRef.current.slice(0, appliedCountRef.current);
    const previous = operations.at(-1);
    const canMergeTyping =
      previous !== undefined &&
      previous.kind !== "composite" &&
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

    trimAndStore(operations);
    currentContentRef.current = content;
    currentSelectionRef.current = selectionStart;
  }, [trimAndStore]);

  /** 多光标批量编辑入栈：单步撤销整体还原。子操作坐标按顺序应用语义（降序提交即原始坐标）。 */
  const pushComposite = useCallback(
    (
      operations: { startUtf16: number; deletedText: string; insertedText: string }[],
      selectionStart: number,
      nextContent: string,
    ) => {
      if (operations.length === 0) return;
      const next = operationsRef.current.slice(0, appliedCountRef.current);
      next.push({
        kind: "composite",
        operations: operations.map((item) => ({
          kind: "single" as const,
          ...item,
          beforeSelection: 0,
          afterSelection: 0,
          timestamp: 0,
        })),
        beforeSelection: currentSelectionRef.current,
        afterSelection: selectionStart,
        timestamp: Date.now(),
      });
      trimAndStore(next);
      currentContentRef.current = nextContent;
      currentSelectionRef.current = selectionStart;
    },
    [trimAndStore],
  );

  const resetHistory = useCallback((content: string) => {
    operationsRef.current = [];
    appliedCountRef.current = 0;
    currentContentRef.current = content;
    currentSelectionRef.current = 0;
  }, []);

  /** 外部内容同步：内容与撤销栈当前状态一致时不清栈（受控回传场景），真正外部变更才重置 */
  const syncExternal = useCallback(
    (content: string) => {
      if (currentContentRef.current === content) return;
      resetHistory(content);
    },
    [resetHistory],
  );

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

  return { pushHistory, pushComposite, resetHistory, syncExternal, undo, redo, historyTimerRef };
}
