import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { EditorStatus, EditorStatusListener } from "../../../Foundation/Types/Editor";

export function useEditorSelection(content: string, path?: string, language?: string) {
  const [currentLine, setCurrentLine] = useState(1);
  const statusListenersRef = useRef(new Set<EditorStatusListener>());
  
  const statusRef = useRef<EditorStatus>({
    hasEditor: true,
    path,
    language: language || "",
    line: 1,
    column: 1,
    selectionLength: 0,
    tabSize: 2,
    insertSpaces: true,
    encoding: "UTF-8",
    lineEnding: "LF",
    errors: 0,
    warnings: 0,
    markers: [],
  });

  const lineStarts = useMemo(() => {
    const starts = [0];
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") starts.push(i + 1);
    }
    return starts;
  }, [content]);

  const getLineAndChar = useCallback(
    (index: number) => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (lineStarts[mid] <= index) {
          if (mid === lineStarts.length - 1 || lineStarts[mid + 1] > index) {
            return { line: mid, char: index - lineStarts[mid] };
          }
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return { line: 0, char: 0 };
    },
    [lineStarts],
  );

  const emitStatus = useCallback((status: EditorStatus) => {
    statusRef.current = status;
    statusListenersRef.current.forEach((listener) => listener(status));
  }, []);

  const updateStatus = useCallback(
    (selectionStart: number, selectionEnd: number) => {
      const { line, char } = getLineAndChar(selectionStart);
      const lineNum = line + 1;
      const column = char + 1;

      emitStatus({
        ...statusRef.current,
        line: lineNum,
        column,
        selectionLength: Math.abs(selectionEnd - selectionStart),
      });
      setCurrentLine(lineNum);
    },
    [emitStatus, getLineAndChar]
  );

  return {
    currentLine,
    statusRef,
    statusListenersRef,
    getLineAndChar,
    emitStatus,
    updateStatus,
    lineStarts
  };
}
