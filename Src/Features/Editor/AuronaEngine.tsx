import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EventBus } from "../../Foundation/EventBus";
import { EditorIPC } from "../../Foundation/IPC/EditorCommands";
import {
  ContextMenuContent,
  ContextMenuDivider,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "../../UI/Components/ContextMenu";
import { LspClient } from "../Editor/LspClient";
import { AutocompleteMenu, type CompletionItem } from "./components/AutocompleteMenu";
import { EditorLine } from "./components/EditorLine";
import { SearchWidget } from "./components/SearchWidget";

import { useEditorHistory } from "./Hooks/useEditorHistory";
import { type DiagnosticItem, sortSelection } from "./Utils/EditorMath";
import { measureTextWidthFast } from "./Utils/TextMeasurement";

export type AuronaEngineProps = {
  value: string;
  language: string;
  isActive?: boolean;
  onChange?: (value: string) => void;
  path?: string;
  revealLine?: number;
  onRevealHandled?: (path: string, line: number) => void;
  onSyncError?: (error: Error) => void;
};

const LINE_HEIGHT = 22;
const LARGE_FILE_BYTES = 2 * 1024 * 1024;
const LARGE_FILE_LINES = 20_000;
const LARGE_FILE_OVERSCAN = 120;

function getLineStartUtf16(lines: string[], lineIndex: number): number {
  let offset = 0;
  for (let index = 0; index < lineIndex; index++) {
    offset += lines[index].length + 1;
  }
  return offset;
}

function getCursorFromUtf16Offset(lines: string[], offset: number) {
  let remaining = Math.max(0, offset);
  for (let line = 0; line < lines.length; line++) {
    if (remaining <= lines[line].length) return { line, char: remaining };
    remaining -= lines[line].length + 1;
  }
  const lastLine = Math.max(0, lines.length - 1);
  return { line: lastLine, char: lines[lastLine]?.length ?? 0 };
}

/**
 * 辅助：计算选区删除后的文本行和光标位置
 */
function getLinesAfterDeletion(
  lines: string[],
  sel: {
    start: { line: number; char: number };
    end: { line: number; char: number };
  },
) {
  const { start, end } = sortSelection(sel);
  const startLineText = lines[start.line] || "";
  const endLineText = lines[end.line] || "";
  const newStartLineText = startLineText.substring(0, start.char) + endLineText.substring(end.char);

  const newLines = [...lines];
  newLines.splice(start.line, end.line - start.line + 1, newStartLineText);
  return {
    lines: newLines,
    cursor: start,
  };
}

export const AuronaEngine = React.memo(function AuronaEngine({
  value,
  language,
  isActive = true,
  onChange,
  path,
  revealLine,
  onRevealHandled,
  onSyncError,
}: AuronaEngineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 文档数据源
  const [documentLines, setDocumentLines] = useState<string[]>([""]);
  const [totalLines, setTotalLines] = useState(1);
  const [maxLineLength, setMaxLineLength] = useState(1);

  // 虚拟滚动
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);

  // 光标、选区与中文输入法
  const [cursor, setCursor] = useState({ line: 0, char: 0 });
  const [selection, setSelection] = useState<{
    start: { line: number; char: number };
    end: { line: number; char: number };
  } | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [compositionText, setCompositionText] = useState("");

  // 光标重置计数器（打字移动光标时重置闪烁周期）
  const [caretBlinkReset, setCaretBlinkReset] = useState(0);

  // 拖动选中标记
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ line: number; char: number } | null>(null);

  // 光标物理坐标
  const [caretPos, setCaretPos] = useState({ x: 16, y: 0 });

  // 搜索相关
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<{ line: number; char: number }[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Autocomplete
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionPos, setCompletionPos] = useState({ x: 0, y: 0 });

  // 诊断与 tooltip
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [hoverTooltip, setHoverTooltip] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );

  // ==========================================
  // 【双字节等宽字体 DOM 临时元素字宽测量引擎】
  // ==========================================
  const [charWidth, setCharWidth] = useState(8.4);
  const { pushHistory, resetHistory, undo, redo } = useEditorHistory("");
  const documentLoadedRef = useRef(false);
  const lastHistoryContentRef = useRef("");

  useEffect(() => {
    if (!path || !onSyncError) return;
    return EditorIPC.onSyncError(path, onSyncError);
  }, [onSyncError, path]);

  useEffect(() => {
    const measure = () => {
      const parent = containerRef.current || document.body;
      const temp = document.createElement("span");
      temp.style.fontFamily = "var(--EditorFontFamily, ui-monospace, monospace)";
      temp.style.fontSize = "14px";
      temp.style.position = "absolute";
      temp.style.visibility = "hidden";
      temp.style.whiteSpace = "pre";
      temp.textContent = "a";
      parent.appendChild(temp);
      const width = temp.getBoundingClientRect().width;
      parent.removeChild(temp);
      if (width > 0) {
        setCharWidth(width);
      }
    };
    measure();
    document.fonts.ready.then(measure);
  }, [containerRef]);

  // ==========================================
  // 【混合动力 Caret 定位引擎：Canvas 离屏渲染精确测量】
  // ==========================================
  const getCaretPixelPosition = useCallback(
    (lineIndex: number, charIndex: number) => {
      const lineText = documentLines[lineIndex] || "";
      let textToMeasure = lineText.substring(0, charIndex);
      if (
        isComposing &&
        compositionText &&
        lineIndex === cursor.line &&
        charIndex === lineText.length
      ) {
        textToMeasure += compositionText;
      }
      const textWidth = measureTextWidthFast(textToMeasure);
      return { x: textWidth + 16, y: lineIndex * LINE_HEIGHT };
    },
    [documentLines, isComposing, compositionText, cursor.line],
  );

  useLayoutEffect(() => {
    const pos = getCaretPixelPosition(cursor.line, cursor.char);
    setCaretPos(pos);
    setCaretBlinkReset((prev) => prev + 1); // 触发 blink 重置
  }, [cursor, scrollTop, documentLines, isComposing, compositionText, getCaretPixelPosition]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateViewportHeight = () => setViewportHeight(container.clientHeight);
    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ==========================================
  // 【Highlight.js 词法高亮引擎 (Web Worker 异步)】
  // ==========================================
  const [linesTokens, setLinesTokens] = useState<number[][]>([]);
  const [largeLineTokens, setLargeLineTokens] = useState<Map<number, number[]>>(
    () => new Map(),
  );
  const highlightWorkerRef = useRef<Worker | null>(null);
  const highlightTimeoutRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);
  const maxLineLengthTimerRef = useRef<number | null>(null);
  const latestHighlightIdRef = useRef<string>("");
  const latestLargeHighlightRequestRef = useRef<string>("");
  const visibleStartIndex = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT));
  const visibleEndIndex = Math.min(
    totalLines,
    Math.ceil((scrollTop + viewportHeight) / LINE_HEIGHT),
  );
  const isLargeFileMode = totalLines > LARGE_FILE_LINES || value.length > LARGE_FILE_BYTES;

  useEffect(() => {
    return () => {
      if (maxLineLengthTimerRef.current !== null) {
        window.clearTimeout(maxLineLengthTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const HighlightWorker = async () => {
      const WorkerModule = await import("./Workers/highlight.worker?worker");
      return new WorkerModule.default();
    };

    HighlightWorker().then((worker) => {
      highlightWorkerRef.current = worker;
      worker.onmessage = (e: MessageEvent) => {
        if (e.data.id === latestHighlightIdRef.current) {
          setLinesTokens(e.data.tokens);
        }
      };
    });

    return () => {
      highlightWorkerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);

    if (isLargeFileMode) {
      return;
    }

    // 立即同步行数，防止越界
    setLinesTokens((prev) => {
      if (prev.length === documentLines.length) return prev;
      const next = [...prev];
      while (next.length < documentLines.length) next.push([]);
      if (next.length > documentLines.length) next.length = documentLines.length;
      return next;
    });

    highlightTimeoutRef.current = setTimeout(() => {
      if (highlightWorkerRef.current) {
        const id = Date.now().toString();
        latestHighlightIdRef.current = id;
        highlightWorkerRef.current.postMessage({
          id,
          fullText: documentLines.join("\n"),
          language,
          totalLines: documentLines.length,
        });
      }
    }, 150); // 150ms 防抖，保证打字如丝般顺滑
  }, [documentLines, isLargeFileMode, language]);

  useEffect(() => {
    setLargeLineTokens(new Map());
  }, [isLargeFileMode, path]);

  useEffect(() => {
    if (!path || !isLargeFileMode) return;

    const startLine = Math.max(0, visibleStartIndex - LARGE_FILE_OVERSCAN);
    const endLine = Math.min(totalLines, visibleEndIndex + LARGE_FILE_OVERSCAN);
    const requestId = `${path}:${startLine}:${endLine}:${Date.now()}`;
    latestLargeHighlightRequestRef.current = requestId;
    const timer = window.setTimeout(() => {
      EditorIPC.getLines(path, startLine, endLine)
        .then((lines) => {
          if (latestLargeHighlightRequestRef.current !== requestId) return;
          setLargeLineTokens((previous) => {
            const next = new Map(previous);
            for (let index = 0; index < lines.length; index++) {
              next.set(startLine + index, lines[index].tokens);
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

  // ==========================================
  // 【LSP 与文档加载生命周期】
  // ==========================================
  useEffect(() => {
    if (path) return;
    const content = value.replace(/\r\n/g, "\n");
    const lines = content.split("\n");
    setDocumentLines(lines);
    setTotalLines(lines.length);
    updateMaxLineLength(lines);
    resetHistory(content);
    lastHistoryContentRef.current = content;
    documentLoadedRef.current = true;
    return () => {
      documentLoadedRef.current = false;
    };
  }, [path, resetHistory, value]);

  useEffect(() => {
    if (!path) return;
    let isMounted = true;

    EditorIPC.open(path)
      .then((content) => {
        if (!isMounted) return;
        const lines = content.split(/\r?\n/);
        setDocumentLines(lines);
        setTotalLines(lines.length);

        let maxLen = 1;
        lines.forEach((l) => {
          if (l.length > maxLen) maxLen = l.length;
        });
        setMaxLineLength(maxLen);
        resetHistory(content);
        lastHistoryContentRef.current = content;
        documentLoadedRef.current = true;

        const lsp = LspClient.getInstance();
        lsp
          .startServer(language)
          .then(() => {
            if (!isMounted) return;
            lsp.didOpen(language, path, content).catch(console.error);
          })
          .catch(console.error);
      })
      .catch(console.error);

    return () => {
      isMounted = false;
      documentLoadedRef.current = false;
      LspClient.getInstance().didClose(language, path).catch(console.error);
      EditorIPC.close(path).catch(console.error);
    };
  }, [path, language]);

  useEffect(() => {
    if (!documentLoadedRef.current) return;
    const content = documentLines.join("\n");
    if (content === lastHistoryContentRef.current) return;
    pushHistory(content, getLineStartUtf16(documentLines, cursor.line) + cursor.char);
    lastHistoryContentRef.current = content;
  }, [cursor, documentLines, pushHistory]);

  useEffect(() => {
    setDiagnostics([]);
    if (!path) return;
    const unsub = EventBus.on("lsp:diagnostics", (payload: any) => {
      const formattedPath = `file:///${path.replace(/\\/g, "/")}`;
      if (payload.uri === formattedPath) {
        setDiagnostics(payload.diagnostics || []);
      }
    });
    return () => unsub();
  }, [path]);

  useEffect(() => {
    if (!isActive || !path || !revealLine || !textareaRef.current) return;
    const clampedLine = Math.min(Math.max(revealLine, 1), documentLines.length);
    const lineIndex = clampedLine - 1;
    textareaRef.current.focus();
    setCursor({ line: lineIndex, char: 0 });
    setSelection(null);

    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: Math.max(0, lineIndex * LINE_HEIGHT - 100),
        behavior: "smooth",
      });
    }
    onRevealHandled?.(path, revealLine);
  }, [isActive, path, revealLine, onRevealHandled, documentLines.length]);

  // 搜索
  useEffect(() => {
    if (!searchQuery) {
      setSearchMatches([]);
      return;
    }
    const matches: { line: number; char: number }[] = [];
    documentLines.forEach((lineText, lineIdx) => {
      let idx = lineText.toLowerCase().indexOf(searchQuery.toLowerCase());
      while (idx !== -1) {
        matches.push({ line: lineIdx, char: idx });
        idx = lineText.toLowerCase().indexOf(searchQuery.toLowerCase(), idx + searchQuery.length);
      }
    });
    setSearchMatches(matches);
    setCurrentMatchIndex(0);
  }, [searchQuery, documentLines]);

  const handleSearchNext = () => {
    if (searchMatches.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIdx);
    scrollToMatch(searchMatches[nextIdx]);
  };

  const handleSearchPrev = () => {
    if (searchMatches.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prevIdx);
    scrollToMatch(searchMatches[prevIdx]);
  };

  const scrollToMatch = (match: { line: number; char: number }) => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: Math.max(0, match.line * LINE_HEIGHT - 100),
        behavior: "smooth",
      });
      setCursor(match);
    }
  };

  // Autocomplete LSP
  const triggerAutocomplete = (lines: string[], lineIndex: number, charIndex: number) => {
    if (!path) return;
    const lineText = lines[lineIndex] || "";
    const prefixMatch = lineText.substring(0, charIndex).match(/[a-zA-Z0-9_]*$/);
    const prefix = prefixMatch ? prefixMatch[0] : "";

    const reqId = Date.now();
    LspClient.getInstance()
      .getCompletions(language, path, lineIndex, charIndex, reqId)
      .then((res: any) => {
        let items: CompletionItem[] = [];
        if (Array.isArray(res)) items = res;
        else if (res?.items) items = res.items;

        if (items.length > 0 && prefix.length > 0) {
          const y = (lineIndex + 1) * LINE_HEIGHT - scrollTop + 10;
          const scrollLeft = containerRef.current?.scrollLeft || 0;
          const x = caretPos.x - scrollLeft;
          setCompletionPos({ x, y });
          setCompletions(items.slice(0, 30));
          setCompletionIndex(0);
        } else {
          setCompletions([]);
        }
      })
      .catch(() => setCompletions([]));
  };

  const handleAutocompleteSelect = (index: number) => {
    const item = completions[index];
    if (!item) return;

    const lines = [...documentLines];
    const { line, char } = cursor;
    const lineText = lines[line];

    const prefixMatch = lineText.substring(0, char).match(/[a-zA-Z0-9_]*$/);
    const prefix = prefixMatch ? prefixMatch[0] : "";

    const insertText = item.insertText || item.label;
    const startUtf16 = getLineStartUtf16(lines, line) + char - prefix.length;
    const endUtf16 = getLineStartUtf16(lines, line) + char;

    const nextText =
      lineText.substring(0, char - prefix.length) + insertText + lineText.substring(char);
    lines[line] = nextText;

    setDocumentLines(lines);
    setCursor({ line, char: char - prefix.length + insertText.length });
    setCompletions([]);

    if (path) {
      EditorIPC.applyEdit(path, startUtf16, endUtf16, insertText).catch(console.error);
      LspClient.getInstance().didChange(language, path, lines.join("\n"));
    }

    updateMaxLineLength(lines);
    onChange?.(lines.join("\n"));
  };

  // 6. 编辑行为与文本处理
  const getSelectionText = (): string => {
    if (!selection) return "";
    const lines = documentLines;
    const { start, end } = sortSelection(selection);
    if (start.line === end.line) {
      return lines[start.line].substring(start.char, end.char);
    }
    let res = `${lines[start.line].substring(start.char)}\n`;
    for (let i = start.line + 1; i < end.line; i++) {
      res += `${lines[i]}\n`;
    }
    res += lines[end.line].substring(0, end.char);
    return res;
  };

  const deleteSelection = (
    lines: string[],
    sel: {
      start: { line: number; char: number };
      end: { line: number; char: number };
    },
  ) => {
    const { start, end } = sortSelection(sel);
    const startLineText = lines[start.line];
    const endLineText = lines[end.line];

    const startUtf16 = getLineStartUtf16(lines, start.line) + start.char;
    const endUtf16 = getLineStartUtf16(lines, end.line) + end.char;

    const newStartLineText =
      startLineText.substring(0, start.char) + endLineText.substring(end.char);
    lines.splice(start.line, end.line - start.line + 1, newStartLineText);

    setDocumentLines(lines);
    if (path) {
      EditorIPC.applyEdit(path, startUtf16, endUtf16, "").catch(console.error);
      LspClient.getInstance().didChange(language, path, lines.join("\n"));
    }

    setSelection(null);
    setCursor(start);
    updateMaxLineLength(lines);
    setTotalLines(lines.length);
  };

  const updateMaxLineLength = (lines: string[]) => {
    if (maxLineLengthTimerRef.current !== null) {
      window.clearTimeout(maxLineLengthTimerRef.current);
    }
    maxLineLengthTimerRef.current = window.setTimeout(() => {
      let maxLen = 1;
      for (const line of lines) maxLen = Math.max(maxLen, line.length);
      setMaxLineLength(maxLen);
      maxLineLengthTimerRef.current = null;
    }, 120);
  };

  const applyHistoryEntry = useCallback(
    (content: string, selectionStart: number) => {
      const previousContent = documentLines.join("\n");
      if (content === previousContent) return;

      const lines = content.split("\n");
      const nextCursor = getCursorFromUtf16Offset(lines, selectionStart);
      lastHistoryContentRef.current = content;
      setDocumentLines(lines);
      setTotalLines(lines.length);
      updateMaxLineLength(lines);
      setCursor(nextCursor);
      setSelection(null);
      setCompletions([]);

      if (path) {
        EditorIPC.applyEdit(path, 0, previousContent.length, content).catch(console.error);
        LspClient.getInstance().didChange(language, path, content);
      }
      onChange?.(content);
    },
    [documentLines, language, onChange, path],
  );

  const handleUndo = useCallback(() => {
    const entry = undo();
    if (entry) applyHistoryEntry(entry.content, entry.selectionStart);
  }, [applyHistoryEntry, undo]);

  const handleRedo = useCallback(() => {
    const entry = redo();
    if (entry) applyHistoryEntry(entry.content, entry.selectionStart);
  }, [applyHistoryEntry, redo]);

  // 支持选区覆盖写入与合并
  const insertTextAtCursor = (text: string) => {
    let lines = [...documentLines];
    let activeCursor = { ...cursor };

    if (selection) {
      const editStartUtf16 =
        getLineStartUtf16(documentLines, sortSelection(selection).start.line) +
        sortSelection(selection).start.char;
      const editEndUtf16 =
        getLineStartUtf16(documentLines, sortSelection(selection).end.line) +
        sortSelection(selection).end.char;

      const deletion = getLinesAfterDeletion(lines, selection);
      lines = deletion.lines;
      activeCursor = deletion.cursor;
      setSelection(null);

      const { line, char } = activeCursor;
      const lineText = lines[line] || "";
      const newLines = text.split("\n");
      let targetCursor = { line, char };

      if (newLines.length === 1) {
        lines[line] = lineText.substring(0, char) + text + lineText.substring(char);
        targetCursor = { line, char: char + text.length };
      } else {
        const rest = lineText.substring(char);
        lines[line] = lineText.substring(0, char) + newLines[0];
        for (let i = 1; i < newLines.length - 1; i++) {
          lines.splice(line + i, 0, newLines[i]);
        }
        lines.splice(line + newLines.length - 1, 0, newLines[newLines.length - 1] + rest);
        targetCursor = {
          line: line + newLines.length - 1,
          char: newLines[newLines.length - 1].length,
        };
      }

      setDocumentLines(lines);
      setCursor(targetCursor);

      if (path) {
        EditorIPC.applyEdit(path, editStartUtf16, editEndUtf16, text).catch(console.error);
        LspClient.getInstance().didChange(language, path, lines.join("\n"));
        triggerAutocomplete(lines, targetCursor.line, targetCursor.char);
      }
    } else {
      const { line, char } = activeCursor;
      const lineText = lines[line] || "";
      const startUtf16 = getLineStartUtf16(lines, line) + char;
      const newLines = text.split("\n");
      let targetCursor = { line, char };

      if (newLines.length === 1) {
        lines[line] = lineText.substring(0, char) + text + lineText.substring(char);
        targetCursor = { line, char: char + text.length };
      } else {
        const rest = lineText.substring(char);
        lines[line] = lineText.substring(0, char) + newLines[0];
        for (let i = 1; i < newLines.length - 1; i++) {
          lines.splice(line + i, 0, newLines[i]);
        }
        lines.splice(line + newLines.length - 1, 0, newLines[newLines.length - 1] + rest);
        targetCursor = {
          line: line + newLines.length - 1,
          char: newLines[newLines.length - 1].length,
        };
      }

      setDocumentLines(lines);
      setCursor(targetCursor);

      if (path) {
        EditorIPC.applyEdit(path, startUtf16, startUtf16, text).catch(console.error);
        LspClient.getInstance().didChange(language, path, lines.join("\n"));
        triggerAutocomplete(lines, targetCursor.line, targetCursor.char);
      }
    }

    updateMaxLineLength(lines);
    setTotalLines(lines.length);
    onChange?.(lines.join("\n"));
  };

  // 支持选区删除
  const executeSelectionDelete = () => {
    if (!selection) return;
    const lines = [...documentLines];
    const { start, end } = sortSelection(selection);
    const startUtf16 = getLineStartUtf16(documentLines, start.line) + start.char;
    const endUtf16 = getLineStartUtf16(documentLines, end.line) + end.char;

    const deletion = getLinesAfterDeletion(lines, selection);
    setDocumentLines(deletion.lines);
    setCursor(deletion.cursor);
    setSelection(null);

    if (path) {
      EditorIPC.applyEdit(path, startUtf16, endUtf16, "").catch(console.error);
      LspClient.getInstance().didChange(language, path, deletion.lines.join("\n"));
    }
    updateMaxLineLength(deletion.lines);
    setTotalLines(deletion.lines.length);
    onChange?.(deletion.lines.join("\n"));
  };

  // 双击时自动向外扫描，确定当前单词的完整物理范围
  const findWordBoundaries = useCallback((text: string, index: number) => {
    let start = index;
    let end = index;
    const wordCharRegex = /[a-zA-Z0-9_]/;
    while (start > 0 && wordCharRegex.test(text[start - 1])) {
      start--;
    }
    while (end < text.length && wordCharRegex.test(text[end])) {
      end++;
    }
    if (start === end && index < text.length) {
      end = index + 1;
    }
    return { start, end };
  }, []);

  // 辅助统一方向键移动光标与选区更新
  const moveCursor = useCallback(
    (newLine: number, newChar: number, shift: boolean) => {
      const prevCursor = { ...cursor };
      const nextCursor = { line: newLine, char: newChar };

      if (shift) {
        setSelection((prev) => {
          if (!prev) {
            return { start: prevCursor, end: nextCursor };
          }
          return { start: prev.start, end: nextCursor };
        });
      } else {
        setSelection(null);
      }
      setCursor(nextCursor);
    },
    [cursor],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (completions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCompletionIndex((prev) => (prev + 1) % completions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCompletionIndex((prev) => (prev - 1 + completions.length) % completions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleAutocompleteSelect(completionIndex);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCompletions([]);
        return;
      }
    }

    if (isComposing) return;

    const lines = [...documentLines];
    const { line, char } = cursor;
    const lineText = lines[line] || "";

    // 撤销 / 重做
    if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
      return;
    }
    if (e.key === "y" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleRedo();
      return;
    }

    // 全选 Ctrl+A
    if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSelection({
        start: { line: 0, char: 0 },
        end: { line: lines.length - 1, char: lines[lines.length - 1].length },
      });
      setCursor({ line: lines.length - 1, char: lines[lines.length - 1].length });
      return;
    }

    // 搜索 Ctrl+F
    if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setIsSearchOpen(true);
      return;
    }

    // 退格键 Backspace
    if (e.key === "Backspace") {
      e.preventDefault();
      if (selection) {
        executeSelectionDelete();
        return;
      }

      if (char === 0) {
        if (line > 0) {
          const prevLineText = lines[line - 1];
          const startUtf16 = getLineStartUtf16(lines, line - 1) + prevLineText.length;
          lines[line - 1] = prevLineText + lineText;
          lines.splice(line, 1);

          setDocumentLines(lines);
          setCursor({ line: line - 1, char: prevLineText.length });
          if (path) {
            EditorIPC.applyEdit(path, startUtf16, startUtf16 + 1, "").catch(console.error);
            LspClient.getInstance().didChange(language, path, lines.join("\n"));
          }
          setTotalLines(lines.length);
          onChange?.(lines.join("\n"));
        }
      } else {
        let startIdx = char;
        if (e.ctrlKey) {
          const wordCharRegex = /[a-zA-Z0-9_]/;
          if (/\s/.test(lineText[char - 1])) {
            while (startIdx > 0 && /\s/.test(lineText[startIdx - 1])) {
              startIdx--;
            }
          } else if (wordCharRegex.test(lineText[char - 1])) {
            while (startIdx > 0 && wordCharRegex.test(lineText[startIdx - 1])) {
              startIdx--;
            }
          } else {
            startIdx--;
          }
        } else {
          startIdx = char - 1;
        }

        const deleteLen = char - startIdx;
        const startUtf16 = getLineStartUtf16(lines, line) + startIdx;

        let actualDeleteLen = deleteLen;
        if (!e.ctrlKey && char > 0) {
          const charBefore = lineText[char - 1];
          const charAfter = lineText[char];
          const pairs: Record<string, string> = {
            "(": ")",
            "[": "]",
            "{": "}",
            '"': '"',
            "'": "'",
          };
          if (pairs[charBefore] === charAfter) {
            actualDeleteLen = 2;
          }
        }

        lines[line] =
          lineText.substring(0, startIdx) + lineText.substring(startIdx + actualDeleteLen);

        setDocumentLines(lines);
        setCursor({ line, char: startIdx });
        if (path) {
          EditorIPC.applyEdit(path, startUtf16, startUtf16 + actualDeleteLen, "").catch(
            console.error,
          );
          LspClient.getInstance().didChange(language, path, lines.join("\n"));
        }
        onChange?.(lines.join("\n"));
      }
      return;
    }

    // 删除键 Delete
    if (e.key === "Delete") {
      e.preventDefault();
      if (selection) {
        executeSelectionDelete();
        return;
      }

      if (char === lineText.length) {
        if (line < lines.length - 1) {
          const nextLineText = lines[line + 1];
          const startUtf16 = getLineStartUtf16(lines, line) + char;
          lines[line] = lineText + nextLineText;
          lines.splice(line + 1, 1);

          setDocumentLines(lines);
          if (path) {
            EditorIPC.applyEdit(path, startUtf16, startUtf16 + 1, "").catch(console.error);
            LspClient.getInstance().didChange(language, path, lines.join("\n"));
          }
          setTotalLines(lines.length);
          onChange?.(lines.join("\n"));
        }
      } else {
        let endIdx = char;
        if (e.ctrlKey) {
          const wordCharRegex = /[a-zA-Z0-9_]/;
          if (/\s/.test(lineText[char])) {
            while (endIdx < lineText.length && /\s/.test(lineText[endIdx])) {
              endIdx++;
            }
          } else if (wordCharRegex.test(lineText[char])) {
            while (endIdx < lineText.length && wordCharRegex.test(lineText[endIdx])) {
              endIdx++;
            }
          } else {
            endIdx++;
          }
        } else {
          endIdx = char + 1;
        }

        const deleteLen = endIdx - char;
        const startUtf16 = getLineStartUtf16(lines, line) + char;

        lines[line] = lineText.substring(0, char) + lineText.substring(endIdx);

        setDocumentLines(lines);
        if (path) {
          EditorIPC.applyEdit(path, startUtf16, startUtf16 + deleteLen, "").catch(console.error);
          LspClient.getInstance().didChange(language, path, lines.join("\n"));
        }
        onChange?.(lines.join("\n"));
      }
      return;
    }

    // 回车键 Enter
    if (e.key === "Enter") {
      e.preventDefault();
      const indentMatch = lineText.match(/^\s*/);
      const indent = indentMatch ? indentMatch[0] : "";
      const lastChar = lineText.substring(0, char).trim().slice(-1);
      const isBlockOpen = lastChar === "{" || lastChar === "[";
      let insertContent = `\n${indent}`;
      if (isBlockOpen) {
        insertContent = `\n${indent}  \n${indent}`;
      }
      insertTextAtCursor(insertContent);
      return;
    }

    // 制表符 Tab
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        if (lineText.startsWith("  ")) {
          const startUtf16 = getLineStartUtf16(lines, line);
          lines[line] = lineText.substring(2);

          setDocumentLines(lines);
          setCursor({ line, char: Math.max(0, char - 2) });
          if (path) {
            EditorIPC.applyEdit(path, startUtf16, startUtf16 + 2, "").catch(console.error);
            LspClient.getInstance().didChange(language, path, lines.join("\n"));
          }
          onChange?.(lines.join("\n"));
        } else if (lineText.startsWith(" ")) {
          const startUtf16 = getLineStartUtf16(lines, line);
          lines[line] = lineText.substring(1);

          setDocumentLines(lines);
          setCursor({ line, char: Math.max(0, char - 1) });
          if (path) {
            EditorIPC.applyEdit(path, startUtf16, startUtf16 + 1, "").catch(console.error);
            LspClient.getInstance().didChange(language, path, lines.join("\n"));
          }
          onChange?.(lines.join("\n"));
        }
      } else {
        insertTextAtCursor("  ");
      }
      return;
    }

    // 方向键移动（集成 Shift 组合选择）
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (char > 0) {
        moveCursor(line, char - 1, e.shiftKey);
      } else if (line > 0) {
        moveCursor(line - 1, lines[line - 1].length, e.shiftKey);
      }
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (char < lineText.length) {
        moveCursor(line, char + 1, e.shiftKey);
      } else if (line < lines.length - 1) {
        moveCursor(line + 1, 0, e.shiftKey);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (line > 0) {
        moveCursor(line - 1, Math.min(char, lines[line - 1].length), e.shiftKey);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (line < lines.length - 1) {
        moveCursor(line + 1, Math.min(char, lines[line + 1].length), e.shiftKey);
      }
      return;
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (isComposing) return;
    const text = e.currentTarget.value;
    if (text) {
      insertTextAtCursor(text);
      e.currentTarget.value = "";
    }
  };

  // IME 拼音输入法
  const handleCompositionStart = () => {
    setIsComposing(true);
    setCompositionText("");
  };

  const handleCompositionUpdate = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setCompositionText(e.data);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(false);
    setCompositionText("");
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
    const text = e.data;
    if (text) {
      insertTextAtCursor(text);
    }
  };

  // 复制粘贴
  const handleCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const selText = getSelectionText();
    if (selText) {
      e.clipboardData.setData("text/plain", selText);
    } else {
      const currentLineText = documentLines[cursor.line] || "";
      e.clipboardData.setData("text/plain", `${currentLineText}\n`);
    }
  };

  const handleCut = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const selText = getSelectionText();
    if (selText && selection) {
      e.clipboardData.setData("text/plain", selText);
      executeSelectionDelete();
    } else {
      const currentLineText = documentLines[cursor.line] || "";
      e.clipboardData.setData("text/plain", `${currentLineText}\n`);
      const lines = [...documentLines];
      if (lines.length > 1) {
        lines.splice(cursor.line, 1);
        const nextLine = Math.min(cursor.line, lines.length - 1);
        setDocumentLines(lines);
        setCursor({ line: nextLine, char: 0 });
        if (path) {
          const startUtf16 = getLineStartUtf16(documentLines, cursor.line);
          const endUtf16 = startUtf16 + currentLineText.length + 1;
          EditorIPC.applyEdit(path, startUtf16, endUtf16, "").catch(console.error);
          LspClient.getInstance().didChange(language, path, lines.join("\n"));
        }
        setTotalLines(lines.length);
        onChange?.(lines.join("\n"));
      } else {
        lines[0] = "";
        setDocumentLines(lines);
        setCursor({ line: 0, char: 0 });
        if (path) {
          const startUtf16 = 0;
          const endUtf16 = currentLineText.length;
          EditorIPC.applyEdit(path, startUtf16, endUtf16, "").catch(console.error);
          LspClient.getInstance().didChange(language, path, "");
        }
        onChange?.("");
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      insertTextAtCursor(text);
    }
  };

  useEffect(() => {
    if (!isActive) return;
    return EventBus.on("editor:action", (action) => {
      textareaRef.current?.focus();
      switch (action) {
        case "undo":
          handleUndo();
          break;
        case "redo":
          handleRedo();
          break;
        case "copy":
          navigator.clipboard
            .writeText(getSelectionText() || `${documentLines[cursor.line] || ""}\n`)
            .catch(console.error);
          break;
        case "cut":
          navigator.clipboard
            .writeText(getSelectionText() || `${documentLines[cursor.line] || ""}\n`)
            .catch(console.error);
          if (selection) executeSelectionDelete();
          break;
        case "paste":
          navigator.clipboard.readText().then(insertTextAtCursor).catch(console.error);
          break;
        case "selectAll":
          setSelection({
            start: { line: 0, char: 0 },
            end: {
              line: documentLines.length - 1,
              char: documentLines[documentLines.length - 1].length,
            },
          });
          setCursor({
            line: documentLines.length - 1,
            char: documentLines[documentLines.length - 1].length,
          });
          break;
      }
    });
  }, [
    cursor.line,
    documentLines,
    executeSelectionDelete,
    getSelectionText,
    handleRedo,
    handleUndo,
    insertTextAtCursor,
    isActive,
    selection,
  ]);

  // 9. 鼠标双击/三击选择单词/整行 + 拖拽逻辑
  const minTextLengthIndex = (text: string, relativeX: number): number => {
    if (relativeX <= 0) return 0;
    const textForMeasure = text.replace(/\t/g, "  ");
    const totalWidth = measureTextWidthFast(textForMeasure);
    if (relativeX >= totalWidth) return text.length;

    for (let i = 0; i < text.length; i++) {
      const prefix = text.substring(0, i).replace(/\t/g, "  ");
      const nextPrefix = text.substring(0, i + 1).replace(/\t/g, "  ");
      const w1 = measureTextWidthFast(prefix);
      const w2 = measureTextWidthFast(nextPrefix);
      if (relativeX < (w1 + w2) / 2) {
        return i;
      }
    }
    return text.length;
  };

  const handleLineMouseDown = (lineIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
    const lineEl = e.currentTarget;
    const rect = lineEl.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const charIndex = minTextLengthIndex(documentLines[lineIndex] || "", clickX - 16);

    const pos = { line: lineIndex, char: charIndex };

    // 支持三击选中整行
    if (e.detail === 3) {
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
    if (e.detail === 2) {
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
    setCursor(pos);
    isDraggingRef.current = true;
    dragStartRef.current = pos;
    setSelection({ start: pos, end: pos });

    setCompletions([]);
    textareaRef.current?.focus();
    e.preventDefault();
  };

  // 全局 mousemove：支持鼠标拖出视口和拖出编辑行时，自动更新选区，并触发自动滚动（Auto-Scroll）
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
      const lineIndex = Math.max(0, Math.min(totalLines - 1, Math.floor(y / LINE_HEIGHT)));

      // 注意：containerRef 已经是纯文本区域，不包含行号槽，所以不需要再减去 48px
      const x = relativeX + currentScrollLeft;
      const charIndex = minTextLengthIndex(documentLines[lineIndex] || "", x - 16);

      const pos = { line: lineIndex, char: charIndex };
      setSelection({
        start: dragStartRef.current,
        end: pos,
      });
      setCursor(pos);
    };

    window.addEventListener("mousemove", handleGlobalMouseMove);
    return () => window.removeEventListener("mousemove", handleGlobalMouseMove);
  }, [totalLines, documentLines, charWidth]);

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
  }, []);

  const handleLineMouseLeave = () => {
    if (hoverTooltip) setHoverTooltip(null);
  };

  // 10. DOM 渲染结构 (切分段 Span 渲染替代 ::highlight)
  const visibleLinesDOM = useMemo(() => {
    const list = [];
    for (let idx = visibleStartIndex; idx < visibleEndIndex; idx++) {
      const lineText = documentLines[idx] ?? "";
      const isCurrent = idx === cursor.line;
      const tokens = isLargeFileMode
        ? largeLineTokens.get(idx) || []
        : linesTokens[idx] || [];

      const lineDiags = diagnostics.filter((d) => d.range.start.line === idx);
      const searchLineMatches = searchMatches.filter((m) => m.line === idx);

      list.push(
        <EditorLine
          key={idx}
          idx={idx}
          lineText={lineText}
          isCurrent={isCurrent}
          tokens={tokens}
          searchQuery={searchQuery}
          searchLineMatches={searchLineMatches}
          currentMatchIndex={currentMatchIndex}
          searchMatches={searchMatches}
          lineDiags={lineDiags}
          selection={selection}
          isDragging={isDraggingRef.current}
          setHoverTooltip={setHoverTooltip}
          hoverTooltip={hoverTooltip}
          onMouseDown={handleLineMouseDown}
          onMouseLeave={handleLineMouseLeave}
          minTextLengthIndex={minTextLengthIndex}
          isComposing={isComposing}
          compositionText={compositionText}
        />,
      );
    }
    return list;
  }, [
    visibleStartIndex,
    visibleEndIndex,
    documentLines,
    cursor.line,
    linesTokens,
    largeLineTokens,
    isLargeFileMode,
    selection,
    searchQuery,
    searchMatches,
    currentMatchIndex,
    diagnostics,
    isComposing,
    compositionText,
    charWidth,
    hoverTooltip,
  ]);

  // 行号渲染
  const lineNumbersDOM = useMemo(() => {
    const list = [];
    for (let idx = visibleStartIndex; idx < visibleEndIndex; idx++) {
      const isCurrent = idx === cursor.line;
      list.push(
        <div
          key={idx}
          className={`h-[22px] leading-[22px] text-right pr-3 font-mono text-[13px] select-none ${
            isCurrent
              ? "text-[var(--TextHighlight)] font-bold opacity-100"
              : "text-[var(--TextMuted)] opacity-60"
          }`}
        >
          {idx + 1}
        </div>,
      );
    }
    return list;
  }, [visibleStartIndex, visibleEndIndex, cursor.line]);

  const caretStyle = useMemo(() => {
    return {
      top: `${caretPos.y}px`,
      left: `${caretPos.x}px`,
      height: `${LINE_HEIGHT}px`,
    };
  }, [caretPos]);

  return (
    <div className="relative w-full h-full flex bg-transparent overflow-hidden">
      {/* 嵌入跨平台 Span 词法与编辑高亮 CSS */}
      <style>{`
        .hl-token-1 { color: var(--SyntaxKeyword); font-weight: bold; }
        .hl-token-2 { color: var(--SyntaxString); }
        .hl-token-3 { color: var(--SyntaxNumber); }
        .hl-token-4 { color: var(--SyntaxFunction); }
        .hl-token-5 { color: var(--SyntaxVariable); }
        .hl-token-6 { color: var(--SyntaxComment); font-style: italic; }
        .hl-token-7 { color: var(--SyntaxOperator); }
        .hl-token-8 { color: var(--SyntaxBuiltin); }
        .hl-token-9 { color: var(--SyntaxTypeHint, #3b82f6); }

        .hl-search { background-color: rgba(234, 179, 8, 0.25); border-bottom: 1px solid rgba(234, 179, 8, 0.6); }
        .hl-search-active { background-color: rgba(249, 115, 22, 0.45); border-bottom: 2px solid rgba(249, 115, 22, 0.9); }
        .hl-diag-error { text-decoration: underline wavy #ef4444 2px; }
        .hl-diag-warning { text-decoration: underline wavy #eab308 2px; }

        /* 选中高亮段样式 */
        .hl-selection { background-color: rgba(59, 130, 246, 0.3) !important; }

        /* 经典重设呼吸动画光标 */
        @keyframes caret-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .editor-caret {
          animation: caret-blink 1s step-end infinite;
        }
      `}</style>

      {isSearchOpen && (
        <SearchWidget
          onSearch={setSearchQuery}
          onClose={() => {
            setIsSearchOpen(false);
            setSearchQuery("");
            setSearchMatches([]);
            textareaRef.current?.focus();
          }}
          onNext={handleSearchNext}
          onPrev={handleSearchPrev}
          totalMatches={searchMatches.length}
          currentIndex={currentMatchIndex}
        />
      )}

      {/* 侧边行号 */}
      <div
        className="w-[48px] shrink-0 border-r border-black/5 dark:border-white/5 py-0 flex flex-col overflow-hidden select-none"
        style={{
          transform: `translateY(-${scrollTop % LINE_HEIGHT}px)`,
        }}
      >
        {lineNumbersDOM}
      </div>

      {/* 主滚动编辑区 */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-auto aurona-scroll select-none p-0"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <ContextMenuRoot>
          <ContextMenuTrigger asChild>
            {/* 修复：使用 minWidth: 100% 确保短文本行的高亮背景能拉满至编辑器最右侧宽度 */}
            <div
              className="relative"
              style={{
                height: `${totalLines * LINE_HEIGHT + 100}px`,
                width: `${maxLineLength * charWidth + 200}px`,
                minWidth: "100%",
              }}
            >
              <div
                className="absolute left-0 w-full"
                style={{
                  transform: `translateY(${Math.max(0, visibleStartIndex * LINE_HEIGHT)}px)`,
                }}
              >
                {visibleLinesDOM}
              </div>

              {/* 逻辑绝对定位光标（重置 blink 帧） */}
              {isActive && (
                <div
                  key={`caret-${caretBlinkReset}`}
                  className="absolute w-[2px] bg-[var(--AccentPrimary)] editor-caret pointer-events-none z-20"
                  style={caretStyle}
                />
              )}

              {/* 隐藏的代理 Textarea */}
              <textarea
                ref={textareaRef}
                onKeyDown={handleKeyDown}
                onInput={handleInput}
                onCompositionStart={handleCompositionStart}
                onCompositionUpdate={handleCompositionUpdate}
                onCompositionEnd={handleCompositionEnd}
                onCopy={handleCopy}
                onCut={handleCut}
                onPaste={handlePaste}
                className="absolute opacity-0 pointer-events-none w-1 h-1 z-30"
                style={caretStyle}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-64">
            <ContextMenuItem label="撤销" onSelect={handleUndo} />
            <ContextMenuItem label="重做" onSelect={handleRedo} />
            <ContextMenuDivider />
            <ContextMenuItem
              label="剪切"
              onSelect={() =>
                textareaRef.current &&
                handleCut({
                  preventDefault: () => {},
                  clipboardData: {
                    setData: (t: string, d: string) => navigator.clipboard.writeText(d),
                  },
                } as any)
              }
            />
            <ContextMenuItem
              label="复制"
              onSelect={() =>
                textareaRef.current &&
                handleCopy({
                  preventDefault: () => {},
                  clipboardData: {
                    setData: (t: string, d: string) => navigator.clipboard.writeText(d),
                  },
                } as any)
              }
            />
            <ContextMenuItem
              label="粘贴"
              onSelect={() => navigator.clipboard.readText().then(insertTextAtCursor)}
            />
            <ContextMenuDivider />
            <ContextMenuItem
              label="全选"
              onSelect={() => {
                setSelection({
                  start: { line: 0, char: 0 },
                  end: {
                    line: documentLines.length - 1,
                    char: documentLines[documentLines.length - 1].length,
                  },
                });
                setCursor({
                  line: documentLines.length - 1,
                  char: documentLines[documentLines.length - 1].length,
                });
              }}
            />
          </ContextMenuContent>
        </ContextMenuRoot>
      </div>

      {/* Autocomplete 智能提示层 */}
      {completions.length > 0 && (
        <AutocompleteMenu
          x={completionPos.x}
          y={completionPos.y}
          items={completions}
          selectedIndex={completionIndex}
          onSelect={handleAutocompleteSelect}
        />
      )}

      {/* 诊断 hover 提示层 */}
      {hoverTooltip && (
        <div
          className="fixed z-50 p-2 text-[12px] rounded-lg shadow-lg border border-[var(--GlassBorder)] bg-[var(--GlassSurface-Floating)] backdrop-blur-[var(--glass-blur-floating)] text-[var(--TextHighlight)] pointer-events-none"
          style={{
            top: `${hoverTooltip.y}px`,
            left: `${hoverTooltip.x}px`,
          }}
        >
          {hoverTooltip.text}
        </div>
      )}
    </div>
  );
});
