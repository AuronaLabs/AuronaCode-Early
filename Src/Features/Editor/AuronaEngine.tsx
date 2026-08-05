import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DebugService } from "../../Core/DebugService";
import { DiagnosticsService } from "../../Core/DiagnosticsService";
import { DocumentService } from "../../Core/DocumentService";
import { applyLspTextEdits } from "../../Core/Language/TextEdits";
import { EventBus } from "../../Foundation/EventBus";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { LanguageFeaturePreferences } from "../../Foundation/Types/Config";
import type { EditorAction } from "../../Foundation/Types/Editor";
import { useDebugStore } from "../../State/useDebugStore";
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
import { HoverCard } from "./components/HoverCard";
import { SearchWidget } from "./components/SearchWidget";
import { EditorAdapter } from "./EditorAdapter";
import { useEditorHistory } from "./Hooks/useEditorHistory";
import { useEditorHover } from "./Hooks/useEditorHover";
import { useSyntaxHighlighting } from "./Hooks/useSyntaxHighlighting";
import type { IEditorEngine } from "./IEditorEngine";
import { pointerSelectionDecision } from "./Utils/EditorInteraction";
import {
  DEFAULT_EDITOR_LAYOUT,
  editorTextIndexAtX,
  editorTextIndexFromPoint,
  measureEditorText,
  measureRenderedEditorRange,
  nextGraphemeBoundary,
  previousGraphemeBoundary,
  readEditorLayoutMetrics,
  sameEditorLayout,
} from "./Utils/EditorLayoutMetrics";
import {
  affectedLineRange,
  duplicateLineRange,
  indentLineRange,
  moveLineRange,
  outdentLineRange,
  toggleLineComment,
} from "./Utils/EditorLineOperations";
import {
  type DiagnosticItem,
  diagnosticsForLine,
  normalizeEditorText,
  sortSelection,
} from "./Utils/EditorMath";
import { editorPointToViewport } from "./Utils/EditorOverlay";

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

const DEFAULT_LANGUAGE_PREFERENCES: Required<LanguageFeaturePreferences> = {
  hoverEnabled: true,
  hoverDelayMs: 350,
  automaticCompletion: true,
};

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
  const breakpoints = useDebugStore((state) => state.breakpoints);
  const toggleBreakpoint = useDebugStore((state) => state.toggleBreakpoint);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineElementsRef = useRef(new Map<number, HTMLButtonElement>());

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

  // 拖动选中标记
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ line: number; char: number } | null>(null);

  // 光标物理坐标
  const [layout, setLayout] = useState(DEFAULT_EDITOR_LAYOUT);
  const [caretPos, setCaretPos] = useState({ x: DEFAULT_EDITOR_LAYOUT.contentInsetX, y: 0 });
  const [, setRenderedLineEpoch] = useState(0);

  const registerLineElement = useCallback(
    (lineIndex: number, element: HTMLButtonElement | null) => {
      const current = lineElementsRef.current.get(lineIndex);
      if (element && current !== element) {
        lineElementsRef.current.set(lineIndex, element);
        setRenderedLineEpoch((epoch) => epoch + 1);
      } else if (!element && current) {
        lineElementsRef.current.delete(lineIndex);
        setRenderedLineEpoch((epoch) => epoch + 1);
      }
    },
    [],
  );

  // 搜索相关
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<{ line: number; char: number }[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Autocomplete
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionPos, setCompletionPos] = useState({ x: 0, y: 0 });
  const completionTimerRef = useRef<number | null>(null);
  const completionRequestRef = useRef<number | null>(null);
  const completionSequenceRef = useRef(1);

  // 诊断与 tooltip
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [languagePreferences, setLanguagePreferences] = useState(DEFAULT_LANGUAGE_PREFERENCES);
  const isHoverInteractionBlocked = useCallback(
    () => isDraggingRef.current || isComposing,
    [isComposing],
  );
  const {
    tooltip: hoverTooltip,
    isContextMenuOpen,
    dismiss: dismissHover,
    setVisibleTooltip: setVisibleHover,
    setContextMenuOpen: setHoverContextMenuOpen,
    requestLanguageHover: handleLanguageHover,
    handleLineMouseLeave,
    handleTooltipMouseEnter: handleHoverEnter,
    handleTooltipMouseLeave: handleHoverLeave,
  } = useEditorHover({
    path,
    language,
    preferences: languagePreferences,
    interactionBlocked: isHoverInteractionBlocked,
  });

  const handleContextMenuOpenChange = useCallback(
    (open: boolean) => {
      setHoverContextMenuOpen(open);
      if (open) {
        setCompletions([]);
        return;
      }
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [setHoverContextMenuOpen],
  );

  const { pushHistory, resetHistory, undo, redo } = useEditorHistory("");
  const documentLoadedRef = useRef(false);
  const lastHistoryContentRef = useRef("");

  useEffect(() => {
    if (!path || !onSyncError) return;
    return DocumentService.onSyncError(path, onSyncError);
  }, [onSyncError, path]);

  useEffect(() => {
    const refresh = () => {
      void UserConfigStore.get().then((config) => {
        setLanguagePreferences({
          ...DEFAULT_LANGUAGE_PREFERENCES,
          ...config.languageFeatures,
        });
      });
    };
    refresh();
    return EventBus.on("settings:language-changed", refresh);
  }, []);

  useEffect(
    () => () => {
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
      if (completionRequestRef.current !== null) {
        void LspClient.getInstance().cancelRequest(language, completionRequestRef.current);
      }
    },
    [language],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const refresh = () => {
      const next = readEditorLayoutMetrics(container);
      setLayout((current) => (sameEditorLayout(current, next) ? current : next));
    };
    refresh();
    void document.fonts.ready.then(refresh);
    const resizeObserver = new ResizeObserver(refresh);
    resizeObserver.observe(container);
    const mutationObserver = new MutationObserver(refresh);
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-density"],
    });
    window.addEventListener("resize", refresh);
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", refresh);
    };
  }, []);

  // ==========================================
  // 【混合动力 Caret 定位引擎：Canvas 离屏渲染精确测量】
  // ==========================================
  const getCaretPixelPosition = useCallback(
    (lineIndex: number, charIndex: number) => {
      const lineText = documentLines[lineIndex] || "";
      const lineElement = lineElementsRef.current.get(lineIndex);
      const rendered = lineElement
        ? measureRenderedEditorRange(lineElement, charIndex, charIndex)
        : null;
      if (rendered && lineElement) {
        const compositionElement =
          isComposing &&
          compositionText &&
          lineIndex === cursor.line &&
          charIndex === lineText.length
            ? lineElement.querySelector<HTMLElement>("[data-editor-composition]")
            : null;
        const compositionRect = compositionElement?.getBoundingClientRect();
        const lineRect = lineElement.getBoundingClientRect();
        return {
          x: compositionRect ? compositionRect.right - lineRect.left : rendered.left,
          y: layout.contentInsetTop + lineIndex * layout.lineHeight,
        };
      }
      let textToMeasure = lineText.substring(0, charIndex);
      if (
        isComposing &&
        compositionText &&
        lineIndex === cursor.line &&
        charIndex === lineText.length
      ) {
        textToMeasure += compositionText;
      }
      return {
        x: measureEditorText(textToMeasure, layout) + layout.contentInsetX,
        y: layout.contentInsetTop + lineIndex * layout.lineHeight,
      };
    },
    [documentLines, isComposing, compositionText, cursor.line, layout],
  );

  useLayoutEffect(() => {
    const pos = getCaretPixelPosition(cursor.line, cursor.char);
    setCaretPos((current) => (current.x === pos.x && current.y === pos.y ? current : pos));
  });

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
  const maxLineLengthTimerRef = useRef<number | null>(null);
  const { linesTokens, largeLineTokens, visibleStartIndex, visibleEndIndex, isLargeFileMode } =
    useSyntaxHighlighting({
      documentLines,
      language,
      path,
      valueLength: value.length,
      totalLines,
      scrollTop,
      viewportHeight,
      contentInsetTop: layout.contentInsetTop,
      lineHeight: layout.lineHeight,
    });

  useEffect(() => {
    return () => {
      if (maxLineLengthTimerRef.current !== null) {
        window.clearTimeout(maxLineLengthTimerRef.current);
      }
    };
  }, []);

  const updateMaxLineLength = useCallback((lines: string[]) => {
    if (maxLineLengthTimerRef.current !== null) {
      window.clearTimeout(maxLineLengthTimerRef.current);
    }
    maxLineLengthTimerRef.current = window.setTimeout(() => {
      let maxLen = 1;
      for (const line of lines) maxLen = Math.max(maxLen, line.length);
      setMaxLineLength(maxLen);
      maxLineLengthTimerRef.current = null;
    }, 120);
  }, []);

  // ==========================================
  // 【文档投影加载生命周期】
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
  }, [path, resetHistory, value, updateMaxLineLength]);

  useEffect(() => {
    if (!path) return;
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
  }, [path, resetHistory, updateMaxLineLength, value]);

  useEffect(() => {
    if (!documentLoadedRef.current) return;
    const content = documentLines.join("\n");
    if (content === lastHistoryContentRef.current) return;
    pushHistory(content, getLineStartUtf16(documentLines, cursor.line) + cursor.char);
    lastHistoryContentRef.current = content;
  }, [cursor, documentLines, pushHistory]);

  useEffect(() => {
    if (!path) {
      setDiagnostics([]);
      return;
    }
    const refresh = () => {
      const uri = LspClient.getInstance().getKnownFileUri(path) ?? DocumentService.get(path)?.uri;
      const document = DiagnosticsService.get(uri);
      setDiagnostics(
        (document?.diagnostics ?? []).map((diagnostic) => ({
          ...diagnostic,
          severity: diagnostic.severity ?? 3,
        })),
      );
    };
    refresh();
    return DiagnosticsService.subscribe(refresh);
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
        top: Math.max(0, layout.contentInsetTop + lineIndex * layout.lineHeight - 100),
        behavior: "smooth",
      });
    }
    onRevealHandled?.(path, revealLine);
  }, [
    isActive,
    path,
    revealLine,
    onRevealHandled,
    documentLines.length,
    layout.contentInsetTop,
    layout.lineHeight,
  ]);

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
        top: Math.max(0, layout.contentInsetTop + match.line * layout.lineHeight - 100),
        behavior: "smooth",
      });
      setCursor(match);
    }
  };

  // Autocomplete LSP
  const triggerAutocomplete = useCallback(
    (lines: string[], lineIndex: number, charIndex: number, manual = false) => {
      if (!path) return;
      if (!manual && !languagePreferences.automaticCompletion) return;
      const lineText = lines[lineIndex] || "";
      const prefixMatch = lineText.substring(0, charIndex).match(/[a-zA-Z0-9_]*$/);
      const prefix = prefixMatch ? prefixMatch[0] : "";
      const expectedContent = lines.join("\n");
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
      if (completionRequestRef.current !== null) {
        void LspClient.getInstance().cancelRequest(language, completionRequestRef.current);
      }
      completionTimerRef.current = window.setTimeout(
        () => {
          completionTimerRef.current = null;
          const requestId = completionSequenceRef.current++;
          completionRequestRef.current = requestId;
          void DocumentService.flush(path)
            .then(() =>
              LspClient.getInstance().getCompletions(
                language,
                path,
                lineIndex,
                charIndex,
                requestId,
              ),
            )
            .then((response) => {
              if (
                completionRequestRef.current !== requestId ||
                DocumentService.get(path)?.content !== expectedContent
              ) {
                return;
              }
              const rawItems = Array.isArray(response) ? response : (response?.items ?? []);
              const items = rawItems
                .filter((item) => {
                  const candidate = item.filterText ?? item.label;
                  return !prefix || candidate.toLowerCase().startsWith(prefix.toLowerCase());
                })
                .sort((left, right) =>
                  (left.sortText ?? left.label).localeCompare(right.sortText ?? right.label),
                )
                .slice(0, 100);
              if (!items.length) {
                setCompletions([]);
                return;
              }
              const container = containerRef.current;
              if (!container) return;
              const bounds = container.getBoundingClientRect();
              const viewportPoint = editorPointToViewport(
                bounds,
                {
                  x: caretPos.x,
                  y: layout.contentInsetTop + (lineIndex + 1) * layout.lineHeight + 6,
                },
                { left: container.scrollLeft, top: container.scrollTop },
              );
              setCompletionPos(viewportPoint);
              setCompletions(items);
              setCompletionIndex(0);
            })
            .catch((error) => {
              if (completionRequestRef.current === requestId) setCompletions([]);
              if (manual) {
                const bounds = containerRef.current?.getBoundingClientRect();
                const left = (bounds?.left ?? 0) + caretPos.x;
                const top =
                  (bounds?.top ?? 0) +
                  layout.contentInsetTop +
                  lineIndex * layout.lineHeight -
                  scrollTop;
                setVisibleHover({
                  anchor: {
                    left,
                    right: left,
                    top,
                    bottom: top + layout.lineHeight,
                  },
                  title: "无法获取补全",
                  text: error instanceof Error ? error.message : String(error),
                  tone: "warning",
                });
              }
            })
            .finally(() => {
              if (completionRequestRef.current === requestId) {
                completionRequestRef.current = null;
              }
            });
        },
        manual ? 0 : 120,
      );
    },
    [
      caretPos.x,
      language,
      languagePreferences.automaticCompletion,
      layout,
      path,
      scrollTop,
      setVisibleHover,
    ],
  );

  const handleAutocompleteSelect = (index: number) => {
    const item = completions[index];
    if (!item || !path) return;
    const content = documentLines.join("\n");
    const { line, char } = cursor;
    const lineText = documentLines[line] ?? "";
    const prefix = lineText.substring(0, char).match(/[a-zA-Z0-9_]*$/)?.[0] ?? "";
    const rawText = item.textEdit?.newText ?? item.insertText ?? item.label;
    const insertText = item.insertTextFormat === 2 ? expandSnippet(rawText) : rawText;
    const mainEdit = item.textEdit
      ? { ...item.textEdit, newText: insertText }
      : {
          range: {
            start: { line, character: char - prefix.length },
            end: { line, character: char },
          },
          newText: insertText,
        };
    try {
      const applied = applyLspTextEdits(content, [mainEdit, ...(item.additionalTextEdits ?? [])]);
      const lines = applied.content.split("\n");
      setDocumentLines(lines);
      setTotalLines(lines.length);
      setCursor({
        line: mainEdit.range.start.line,
        char: mainEdit.range.start.character + insertText.length,
      });
      setCompletions([]);
      DocumentService.applyEdits(path, applied.documentEdits, applied.content).catch(console.error);
      updateMaxLineLength(lines);
      onChange?.(applied.content);
    } catch {
      setCompletions([]);
    }
  };

  // 6. 编辑行为与文本处理
  const getSelectionText = useCallback((): string => {
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
  }, [documentLines, selection]);

  const _deleteSelection = (
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
      DocumentService.applyEdit(path, startUtf16, endUtf16, "", lines.join("\n")).catch(
        console.error,
      );
    }

    setSelection(null);
    setCursor(start);
    updateMaxLineLength(lines);
    setTotalLines(lines.length);
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
        DocumentService.applyEdit(path, 0, previousContent.length, content, content).catch(
          console.error,
        );
      }
      onChange?.(content);
    },
    [documentLines, onChange, path, updateMaxLineLength],
  );

  const handleUndo = useCallback(() => {
    const entry = undo();
    if (entry) applyHistoryEntry(entry.content, entry.selectionStart);
  }, [applyHistoryEntry, undo]);

  const handleRedo = useCallback(() => {
    const entry = redo();
    if (entry) applyHistoryEntry(entry.content, entry.selectionStart);
  }, [applyHistoryEntry, redo]);

  const replaceDocumentLines = useCallback(
    (
      lines: string[],
      nextCursor: { line: number; char: number },
      nextSelection: typeof selection = null,
    ) => {
      const previousContent = documentLines.join("\n");
      const content = lines.join("\n");
      if (content === previousContent) return;
      setDocumentLines(lines);
      setTotalLines(lines.length);
      updateMaxLineLength(lines);
      setCursor(nextCursor);
      setSelection(nextSelection);
      setCompletions([]);
      dismissHover();
      if (path) {
        DocumentService.applyEdit(path, 0, previousContent.length, content, content).catch(
          console.error,
        );
      }
      onChange?.(content);
    },
    [dismissHover, documentLines, onChange, path, updateMaxLineLength],
  );

  // 支持选区覆盖写入与合并
  const insertTextAtCursor = useCallback(
    (text: string) => {
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
          DocumentService.applyEdit(
            path,
            editStartUtf16,
            editEndUtf16,
            text,
            lines.join("\n"),
          ).catch(console.error);
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
          DocumentService.applyEdit(path, startUtf16, startUtf16, text, lines.join("\n")).catch(
            console.error,
          );
          triggerAutocomplete(lines, targetCursor.line, targetCursor.char);
        }
      }

      updateMaxLineLength(lines);
      setTotalLines(lines.length);
      onChange?.(lines.join("\n"));
    },
    [cursor, documentLines, onChange, path, selection, triggerAutocomplete, updateMaxLineLength],
  );

  // 支持选区删除
  const executeSelectionDelete = useCallback(() => {
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
      DocumentService.applyEdit(path, startUtf16, endUtf16, "", deletion.lines.join("\n")).catch(
        console.error,
      );
    }
    updateMaxLineLength(deletion.lines);
    setTotalLines(deletion.lines.length);
    onChange?.(deletion.lines.join("\n"));
  }, [documentLines, onChange, path, selection, updateMaxLineLength]);

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

    if (e.key === " " && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      triggerAutocomplete(lines, line, char, true);
      return;
    }

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

    if (e.code === "Slash" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const marker = ["python", "shellscript", "yaml", "toml", "powershell"].includes(language)
        ? "#"
        : ["html", "css", "scss", "markdown", "plaintext"].includes(language)
          ? null
          : "//";
      if (marker) {
        const range = affectedLineRange(line, selection);
        const result = toggleLineComment(lines, range, marker);
        const delta = marker.length + 1;
        const adjust = (position: { line: number; char: number }) => ({
          line: position.line,
          char:
            position.line >= range.startLine && position.line <= range.endLine
              ? Math.max(0, position.char + (result.uncommented ? -delta : delta))
              : position.char,
        });
        const nextSelection = selection
          ? { start: adjust(selection.start), end: adjust(selection.end) }
          : null;
        replaceDocumentLines(result.lines, adjust(cursor), nextSelection);
      }
      return;
    }

    if (e.altKey && e.shiftKey && e.key === "ArrowDown") {
      e.preventDefault();
      const range = affectedLineRange(line, selection);
      const result = duplicateLineRange(lines, range);
      const lineDelta = result.range.startLine - range.startLine;
      const nextSelection = selection
        ? {
            start: { ...selection.start, line: selection.start.line + lineDelta },
            end: { ...selection.end, line: selection.end.line + lineDelta },
          }
        : null;
      replaceDocumentLines(
        result.lines,
        { ...cursor, line: cursor.line + lineDelta },
        nextSelection,
      );
      return;
    }

    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const range = affectedLineRange(line, selection);
      const direction = e.key === "ArrowUp" ? -1 : 1;
      const result = moveLineRange(lines, range, direction);
      const lineDelta = result.range.startLine - range.startLine;
      if (lineDelta !== 0) {
        const nextSelection = selection
          ? {
              start: { ...selection.start, line: selection.start.line + lineDelta },
              end: { ...selection.end, line: selection.end.line + lineDelta },
            }
          : null;
        replaceDocumentLines(
          result.lines,
          { ...cursor, line: cursor.line + lineDelta },
          nextSelection,
        );
      }
      return;
    }

    if (e.key.toLowerCase() === "k" && e.shiftKey && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const range = affectedLineRange(line, selection);
      const nextLines = [...lines];
      nextLines.splice(range.startLine, range.endLine - range.startLine + 1);
      if (nextLines.length === 0) nextLines.push("");
      const nextLine = Math.min(range.startLine, nextLines.length - 1);
      replaceDocumentLines(nextLines, { line: nextLine, char: 0 });
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
            DocumentService.applyEdit(path, startUtf16, startUtf16 + 1, "", lines.join("\n")).catch(
              console.error,
            );
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
            startIdx = previousGraphemeBoundary(lineText, startIdx);
          }
        } else {
          startIdx = previousGraphemeBoundary(lineText, char);
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
          DocumentService.applyEdit(
            path,
            startUtf16,
            startUtf16 + actualDeleteLen,
            "",
            lines.join("\n"),
          ).catch(console.error);
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
            DocumentService.applyEdit(path, startUtf16, startUtf16 + 1, "", lines.join("\n")).catch(
              console.error,
            );
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
            endIdx = nextGraphemeBoundary(lineText, endIdx);
          }
        } else {
          endIdx = nextGraphemeBoundary(lineText, char);
        }

        const deleteLen = endIdx - char;
        const startUtf16 = getLineStartUtf16(lines, line) + char;

        lines[line] = lineText.substring(0, char) + lineText.substring(endIdx);

        setDocumentLines(lines);
        if (path) {
          DocumentService.applyEdit(
            path,
            startUtf16,
            startUtf16 + deleteLen,
            "",
            lines.join("\n"),
          ).catch(console.error);
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
      if (selection) {
        const range = affectedLineRange(line, selection);
        if (e.shiftKey) {
          const result = outdentLineRange(lines, range, layout.tabSize);
          const adjust = (position: { line: number; char: number }) => ({
            line: position.line,
            char: Math.max(0, position.char - (result.removed[position.line] ?? 0)),
          });
          replaceDocumentLines(result.lines, adjust(cursor), {
            start: adjust(selection.start),
            end: adjust(selection.end),
          });
        } else {
          const indent = " ".repeat(layout.tabSize);
          const nextLines = indentLineRange(lines, range, indent);
          const adjust = (position: { line: number; char: number }) => ({
            line: position.line,
            char:
              position.line >= range.startLine && position.line <= range.endLine
                ? position.char + indent.length
                : position.char,
          });
          replaceDocumentLines(nextLines, adjust(cursor), {
            start: adjust(selection.start),
            end: adjust(selection.end),
          });
        }
        return;
      }
      if (e.shiftKey) {
        if (lineText.startsWith("  ")) {
          const startUtf16 = getLineStartUtf16(lines, line);
          lines[line] = lineText.substring(2);

          setDocumentLines(lines);
          setCursor({ line, char: Math.max(0, char - 2) });
          if (path) {
            DocumentService.applyEdit(path, startUtf16, startUtf16 + 2, "", lines.join("\n")).catch(
              console.error,
            );
          }
          onChange?.(lines.join("\n"));
        } else if (lineText.startsWith(" ")) {
          const startUtf16 = getLineStartUtf16(lines, line);
          lines[line] = lineText.substring(1);

          setDocumentLines(lines);
          setCursor({ line, char: Math.max(0, char - 1) });
          if (path) {
            DocumentService.applyEdit(path, startUtf16, startUtf16 + 1, "", lines.join("\n")).catch(
              console.error,
            );
          }
          onChange?.(lines.join("\n"));
        }
      } else {
        insertTextAtCursor("  ");
      }
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      const firstContent = lineText.search(/\S|$/);
      const target = char === firstContent ? 0 : firstContent;
      moveCursor(line, target, e.shiftKey);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      moveCursor(line, lineText.length, e.shiftKey);
      return;
    }

    // 方向键移动（集成 Shift 组合选择）
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (char > 0) {
        moveCursor(line, previousGraphemeBoundary(lineText, char), e.shiftKey);
      } else if (line > 0) {
        moveCursor(line - 1, lines[line - 1].length, e.shiftKey);
      }
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (char < lineText.length) {
        moveCursor(line, nextGraphemeBoundary(lineText, char), e.shiftKey);
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
          DocumentService.applyEdit(path, startUtf16, endUtf16, "", lines.join("\n")).catch(
            console.error,
          );
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
          DocumentService.applyEdit(path, startUtf16, endUtf16, "", "").catch(console.error);
        }
        onChange?.("");
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const text = normalizeEditorText(e.clipboardData.getData("text/plain"));
    if (text) {
      insertTextAtCursor(text);
    }
  };

  const executeEditorAction = useCallback(
    (action: EditorAction) => {
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
          navigator.clipboard
            .readText()
            .then((text) => insertTextAtCursor(normalizeEditorText(text)))
            .catch(console.error);
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
    },
    [
      cursor.line,
      documentLines,
      executeSelectionDelete,
      getSelectionText,
      handleRedo,
      handleUndo,
      insertTextAtCursor,
      selection,
    ],
  );

  // 9. 鼠标双击/三击选择单词/整行 + 拖拽逻辑
  const minTextLengthIndex = useCallback(
    (text: string, relativeX: number): number => editorTextIndexAtX(text, relativeX, layout),
    [layout],
  );

  const textIndexAtPoint = useCallback(
    (
      lineIndex: number,
      lineElement: HTMLButtonElement,
      clientX: number,
      clientY: number,
    ): number => {
      const lineText = documentLines[lineIndex] || "";
      const renderedIndex = editorTextIndexFromPoint(lineElement, clientX, clientY, lineText);
      if (renderedIndex !== null) return renderedIndex;

      const rect = lineElement.getBoundingClientRect();
      return minTextLengthIndex(lineText, clientX - rect.left - layout.contentInsetX);
    },
    [documentLines, layout.contentInsetX, minTextLengthIndex],
  );

  const handleLineMouseDown = useCallback(
    (lineIndex: number, e: React.MouseEvent<HTMLButtonElement>) => {
      const lineEl = e.currentTarget;
      const charIndex = textIndexAtPoint(lineIndex, lineEl, e.clientX, e.clientY);

      const pos = { line: lineIndex, char: charIndex };

      const pointerDecision = pointerSelectionDecision(e.button, pos, selection);
      if (pointerDecision.kind === "preserve-selection") {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        setCompletions([]);
        dismissHover();
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

      setCompletions([]);
      dismissHover();
      if (e.button === 0) {
        textareaRef.current?.focus();
        e.preventDefault();
      }
    },
    [dismissHover, documentLines, findWordBoundaries, selection, textIndexAtPoint],
  );

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
      const lineIndex = Math.max(
        0,
        Math.min(
          totalLines - 1,
          Math.floor(Math.max(0, y - layout.contentInsetTop) / layout.lineHeight),
        ),
      );

      // 注意：containerRef 已经是纯文本区域，不包含行号槽，所以不需要再减去 48px
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
  }, [totalLines, documentLines, layout, minTextLengthIndex, textIndexAtPoint]);

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

  useEffect(() => {
    if (!isActive) return;
    const severity = (value: number | undefined) => {
      if (value === 1) return "error" as const;
      if (value === 2) return "warning" as const;
      if (value === 4) return "hint" as const;
      return "info" as const;
    };
    const status = {
      hasEditor: true,
      path,
      language,
      line: cursor.line + 1,
      column: cursor.char + 1,
      selectionLength: getSelectionText().length,
      tabSize: 2,
      insertSpaces: true,
      encoding: "UTF-8",
      lineEnding: "LF",
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === 1).length,
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 2).length,
      markers: diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        severity: severity(diagnostic.severity),
        line: diagnostic.range.start.line + 1,
        column: diagnostic.range.start.character + 1,
        source: diagnostic.source,
      })),
    };
    const engine: IEditorEngine = {
      getText: () => documentLines.join("\n"),
      getSelectionText,
      insertCode: (text) => insertTextAtCursor(text),
      replaceRange: (startLine, endLine, newText) => {
        const firstLine = Math.max(0, startLine - 1);
        const lastLine = Math.min(documentLines.length - 1, Math.max(firstLine, endLine - 1));
        const startUtf16 = getLineStartUtf16(documentLines, firstLine);
        const endUtf16 =
          getLineStartUtf16(documentLines, lastLine) + (documentLines[lastLine]?.length ?? 0);
        const next = [...documentLines];
        next.splice(firstLine, lastLine - firstLine + 1, ...newText.split("\n"));
        setDocumentLines(next);
        setTotalLines(next.length);
        if (path) {
          DocumentService.applyEdit(path, startUtf16, endUtf16, newText, next.join("\n")).catch(
            console.error,
          );
        }
        onChange?.(next.join("\n"));
      },
      getStatus: () => status,
      onStatusChange: (listener) => {
        listener(status);
        return () => undefined;
      },
      executeAction: executeEditorAction,
    };
    EditorAdapter.bindEngine(engine);
    return () => EditorAdapter.unbindEngine(engine);
  }, [
    cursor,
    diagnostics,
    documentLines,
    executeEditorAction,
    getSelectionText,
    insertTextAtCursor,
    isActive,
    language,
    onChange,
    path,
  ]);

  // 10. DOM 渲染结构 (切分段 Span 渲染替代 ::highlight)
  const visibleLinesDOM = useMemo(() => {
    const list = [];
    for (let idx = visibleStartIndex; idx < visibleEndIndex; idx++) {
      const lineText = documentLines[idx] ?? "";
      const isCurrent = idx === cursor.line;
      const tokens = isLargeFileMode ? largeLineTokens.get(idx) || [] : linesTokens[idx] || [];

      const lineDiags = diagnosticsForLine(diagnostics, idx, lineText.length);
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
          setHoverTooltip={setVisibleHover}
          onMouseDown={handleLineMouseDown}
          onMouseLeave={handleLineMouseLeave}
          onLanguageHover={handleLanguageHover}
          textIndexAtPoint={textIndexAtPoint}
          registerLineElement={registerLineElement}
          isComposing={isComposing}
          compositionText={compositionText}
          layout={layout}
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
    handleLineMouseLeave,
    handleLanguageHover,
    layout,
    textIndexAtPoint,
    registerLineElement,
    handleLineMouseDown,
    setVisibleHover,
  ]);

  // 行号渲染
  const lineNumbersDOM = useMemo(() => {
    const list = [];
    for (let idx = visibleStartIndex; idx < visibleEndIndex; idx++) {
      const isCurrent = idx === cursor.line;
      list.push(
        <button
          type="button"
          key={idx}
          onClick={() => {
            if (!path) return;
            toggleBreakpoint(path, idx + 1);
            queueMicrotask(() => void DebugService.syncBreakpoints());
          }}
          className={`relative w-full text-right pr-3 font-mono text-[13px] select-none ${
            isCurrent
              ? "text-[var(--TextHighlight)] font-bold opacity-100"
              : "text-[var(--TextMuted)] opacity-60"
          }`}
          style={{ height: layout.lineHeight, lineHeight: `${layout.lineHeight}px` }}
        >
          {path && breakpoints.some((item) => item.path === path && item.line === idx + 1) && (
            <span className="absolute left-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-red-500 shadow-sm" />
          )}
          {idx + 1}
        </button>,
      );
    }
    return list;
  }, [
    visibleStartIndex,
    visibleEndIndex,
    cursor.line,
    layout.lineHeight,
    path,
    breakpoints,
    toggleBreakpoint,
  ]);

  const caretStyle = useMemo(() => {
    return {
      top: `${caretPos.y}px`,
      left: `${caretPos.x}px`,
      height: `${layout.lineHeight}px`,
    };
  }, [caretPos, layout.lineHeight]);

  return (
    <div
      className="relative w-full h-full flex bg-transparent overflow-hidden"
      data-editor-font={layout.fontFamily}
      data-editor-font-size={layout.fontSize}
      data-editor-line-height={layout.lineHeight}
      data-editor-inset={layout.contentInsetX}
      data-editor-top-inset={layout.contentInsetTop}
    >
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
        .hl-token-9 { color: var(--SyntaxTypeHint, var(--AccentPrimary)); }

        .hl-search { background-color: rgba(234, 179, 8, 0.25); border-bottom: 1px solid rgba(234, 179, 8, 0.6); }
        .hl-search-active { background-color: rgba(249, 115, 22, 0.45); border-bottom: 2px solid rgba(249, 115, 22, 0.9); }
        .hl-diag-error,
        .hl-diag-warning,
        .hl-diag-info,
        .hl-diag-hint {
          text-decoration-line: underline;
          text-decoration-style: wavy;
          text-decoration-thickness: 1.5px;
          text-underline-offset: 3px;
          text-decoration-skip-ink: none;
        }
        .hl-diag-error { text-decoration-color: #ef4444; }
        .hl-diag-warning { text-decoration-color: #f59e0b; }
        .hl-diag-info { text-decoration-color: #3b82f6; }
        .hl-diag-hint {
          text-decoration-style: dotted;
          text-decoration-color: var(--TextMuted);
        }

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
          paddingTop: `${Math.max(0, layout.contentInsetTop - scrollTop)}px`,
          transform:
            scrollTop < layout.contentInsetTop
              ? undefined
              : `translateY(-${(scrollTop - layout.contentInsetTop) % layout.lineHeight}px)`,
        }}
      >
        {lineNumbersDOM}
      </div>

      {/* 主滚动编辑区 */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-auto aurona-scroll select-none p-0"
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          setCompletions([]);
          dismissHover();
        }}
      >
        <ContextMenuRoot onOpenChange={handleContextMenuOpenChange}>
          <ContextMenuTrigger asChild>
            {/* 修复：使用 minWidth: 100% 确保短文本行的高亮背景能拉满至编辑器最右侧宽度 */}
            <div
              className="relative"
              style={{
                height: `${layout.contentInsetTop + totalLines * layout.lineHeight + 100}px`,
                width: `${maxLineLength * measureEditorText("0", layout) + 200}px`,
                minWidth: "100%",
              }}
            >
              <div
                className="absolute left-0 w-full"
                style={{
                  transform: `translateY(${layout.contentInsetTop + Math.max(0, visibleStartIndex * layout.lineHeight)}px)`,
                }}
              >
                {visibleLinesDOM}
              </div>

              {/* 逻辑绝对定位光标（重置 blink 帧） */}
              {isActive && (
                <div
                  key={`caret-${cursor.line}-${cursor.char}`}
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
            <ContextMenuItem label="剪切" onSelect={() => executeEditorAction("cut")} />
            <ContextMenuItem label="复制" onSelect={() => executeEditorAction("copy")} />
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
      {hoverTooltip && !isContextMenuOpen && (
        <HoverCard
          hover={hoverTooltip}
          onMouseEnter={handleHoverEnter}
          onMouseLeave={handleHoverLeave}
        />
      )}
      {import.meta.env.DEV &&
        new URLSearchParams(window.location.search).has("editorLayoutDebug") && (
          <div className="pointer-events-none absolute bottom-2 right-2 z-50 rounded-lg border border-[var(--border-overlay)] bg-[var(--material-overlay)] px-2 py-1 font-mono text-[10px] text-[var(--TextMuted)] shadow-[var(--shadow-overlay)] backdrop-blur-[var(--glass-blur-floating)]">
            {layout.fontSize}px / {layout.lineHeight}px · inset {layout.contentInsetX}px · DPR{" "}
            {layout.devicePixelRatio.toFixed(2)} · caret {caretPos.x.toFixed(1)},{" "}
            {caretPos.y.toFixed(1)}
          </div>
        )}
    </div>
  );
});

function expandSnippet(snippet: string): string {
  return snippet
    .replace(/\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "")
    .replace(/\$\d+/g, "");
}
