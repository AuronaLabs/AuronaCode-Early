import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DebugService } from "../../Core/DebugService";
import { DiagnosticsService } from "../../Core/DiagnosticsService";
import { DocumentService } from "../../Core/DocumentService";
import { EditorAdapter } from "../../Core/Editor/EditorAdapter";
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
import { AutocompleteMenu } from "./components/AutocompleteMenu";
import { EditorLine } from "./components/EditorLine";
import { HoverCard } from "./components/HoverCard";
import { SearchWidget } from "./components/SearchWidget";
import { useEditorAutocomplete } from "./Hooks/useEditorAutocomplete";
import { useEditorContextMenu } from "./Hooks/useEditorContextMenu";
import { useEditorGutterMetrics } from "./Hooks/useEditorGutterMetrics";
import { useEditorHistory } from "./Hooks/useEditorHistory";
import { useEditorHover } from "./Hooks/useEditorHover";
import { useEditorIME } from "./Hooks/useEditorIME";
import { useEditorKeybindings } from "./Hooks/useEditorKeybindings";
import { useEditorPointerSelection } from "./Hooks/useEditorPointerSelection";
import { type EditorSearchMatch, useEditorSearch } from "./Hooks/useEditorSearch";
import {
  getCursorFromUtf16Offset,
  getLineStartUtf16,
  type SelectionRange,
  useEditorSelectionOps,
} from "./Hooks/useEditorSelectionOps";
import { useSyntaxHighlighting } from "./Hooks/useSyntaxHighlighting";
import type { IEditorEngine } from "./IEditorEngine";
import {
  DEFAULT_EDITOR_LAYOUT,
  editorTextIndexAtX,
  editorTextIndexFromPoint,
  measureEditorText,
  measureRenderedEditorRange,
  readEditorLayoutMetrics,
  sameEditorLayout,
} from "./Utils/EditorLayoutMetrics";
import {
  type DiagnosticItem,
  diagnosticsForLine,
  normalizeEditorText,
  sortSelection,
} from "./Utils/EditorMath";
import { insertTextIntoLines } from "./Utils/EditorTextInsert";

export type AuronaEngineProps = {
  value: string;
  language: string;
  isActive?: boolean;
  onChange?: (value: string) => void;
  path?: string;
  revealLine?: number;
  onRevealHandled?: (path: string, line: number) => void;
  onSyncError?: (error: Error) => void;
  /** 外部修改（Rename/Code Action 等 WorkspaceEdit）应用到文档后，用于同步编辑器视图。 */
  externalContent?: { content: string; nonce: number } | null;
};

const DEFAULT_LANGUAGE_PREFERENCES: Required<LanguageFeaturePreferences> = {
  hoverEnabled: true,
  hoverDelayMs: 600,
  automaticCompletion: true,
};

export const AuronaEngine = React.memo(function AuronaEngine({
  value,
  language,
  isActive = true,
  onChange,
  path,
  revealLine,
  onRevealHandled,
  onSyncError,
  externalContent,
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

  // 光标与选区
  const [cursor, setCursor] = useState({ line: 0, char: 0 });
  const [selection, setSelection] = useState<SelectionRange | null>(null);

  const insertTextAtCursorRef = useRef<(text: string) => void>(() => {});
  const {
    isComposing,
    compositionText,
    handleCompositionStart,
    handleCompositionUpdate,
    handleCompositionEnd,
  } = useEditorIME({
    textareaRef,
    onCommitText: (text) => insertTextAtCursorRef.current(text),
  });

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

  const updateMaxLineLength = useCallback((lines: string[]) => {
    let max = 1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > max) max = lines[i].length;
    }
    setMaxLineLength(max);
  }, []);

  const [languagePreferences, setLanguagePreferences] = useState<
    Required<LanguageFeaturePreferences>
  >(DEFAULT_LANGUAGE_PREFERENCES);

  useEffect(() => {
    let isMounted = true;
    UserConfigStore.get()
      .then((config) => {
        if (!isMounted) return;
        const preferences = config.languageFeatures;
        setLanguagePreferences({
          hoverEnabled: preferences?.hoverEnabled ?? DEFAULT_LANGUAGE_PREFERENCES.hoverEnabled,
          hoverDelayMs: preferences?.hoverDelayMs ?? DEFAULT_LANGUAGE_PREFERENCES.hoverDelayMs,
          automaticCompletion:
            preferences?.automaticCompletion ?? DEFAULT_LANGUAGE_PREFERENCES.automaticCompletion,
        });
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, []);

  // 1. 历史栈管理
  const { undo, redo, pushHistory } = useEditorHistory(value);

  // 2. 选区操作 Hook
  const { executeSelectionDelete, findWordBoundaries, moveCursor } = useEditorSelectionOps({
    documentLines,
    selection,
    cursor,
    path,
    setDocumentLines,
    setCursor,
    setSelection,
    updateMaxLineLength,
    setTotalLines,
    onChange,
  });

  // 3. 诊断信息
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  useEffect(() => {
    if (!path) return;
    const mapDiags = () => {
      const raw = DiagnosticsService.get(path)?.diagnostics ?? [];
      return raw.map((item) => ({
        range: item.range,
        message: item.message,
        severity: item.severity ?? 1,
        source: item.source,
      }));
    };
    setDiagnostics(mapDiags());
    const unsubscribe = DiagnosticsService.subscribe(() => {
      setDiagnostics(mapDiags());
    });
    return unsubscribe;
  }, [path]);

  // 4. 行视口计算
  const visibleStartIndex = Math.max(
    0,
    Math.floor(Math.max(0, scrollTop - layout.contentInsetTop) / layout.lineHeight),
  );
  const visibleEndIndex = Math.min(
    totalLines,
    Math.ceil(Math.max(0, scrollTop - layout.contentInsetTop + viewportHeight) / layout.lineHeight),
  );

  const { gutterOffsetY } = useEditorGutterMetrics({
    totalLines,
    visibleStartIndex,
    layout,
  });

  // 5. 语法高亮
  const { linesTokens, largeLineTokens, isLargeFileMode } = useSyntaxHighlighting({
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

  // 6. 统一替换文档内容并同步
  const replaceDocumentLines = useCallback(
    (
      nextLines: string[],
      nextCursor: { line: number; char: number },
      nextSelection: SelectionRange | null = null,
    ) => {
      const startUtf16 = 0;
      const endUtf16 = documentLines.reduce((acc, l) => acc + l.length + 1, 0);
      const nextContent = nextLines.join("\n");

      setDocumentLines(nextLines);
      setTotalLines(nextLines.length);
      setCursor(nextCursor);
      setSelection(nextSelection);
      updateMaxLineLength(nextLines);

      if (path) {
        DocumentService.applyEdit(path, startUtf16, endUtf16, nextContent, nextContent).catch(
          (error) => {
            onSyncError?.(error instanceof Error ? error : new Error(String(error)));
          },
        );
      }
      onChange?.(nextContent);
    },
    [documentLines, onChange, onSyncError, path, updateMaxLineLength],
  );

  // 7. Hover 与诊断浮层
  const isDraggingPointerRef = useRef(false);
  const [isContextMenuOpen, setHoverContextMenuOpen] = useState(false);
  const {
    tooltip: hoverTooltip,
    setVisibleTooltip: setVisibleHover,
    requestLanguageHover,
    handleLineMouseLeave,
    handleTooltipMouseEnter: handleHoverEnter,
    handleTooltipMouseLeave: handleHoverLeave,
    dismiss: dismissHover,
  } = useEditorHover({
    path,
    language,
    preferences: languagePreferences,
    interactionBlocked: () => isDraggingPointerRef.current || isContextMenuOpen,
  });

  // 8. 自动补全 Hook
  const {
    completions,
    completionIndex,
    completionPos,
    setCompletionIndex,
    setCompletions,
    closeAutocomplete,
    triggerAutocomplete,
    handleAutocompleteSelect,
  } = useEditorAutocomplete({
    path,
    language,
    layout,
    languagePreferences,
    containerRef,
    caretPos,
    scrollTop,
    documentLines,
    cursor,
    replaceDocumentLines,
    setVisibleHover,
  });

  // 9. 选区文本读取
  const getSelectionText = useCallback((): string => {
    if (!selection) return "";
    const { start, end } = sortSelection(selection);
    if (start.line === end.line) {
      return (documentLines[start.line] || "").substring(start.char, end.char);
    }
    const result: string[] = [];
    result.push((documentLines[start.line] || "").substring(start.char));
    for (let i = start.line + 1; i < end.line; i++) {
      result.push(documentLines[i] || "");
    }
    result.push((documentLines[end.line] || "").substring(0, end.char));
    return result.join("\n");
  }, [documentLines, selection]);

  // 10. 滚动至光标
  const scrollToCursor = useCallback(
    (pos = cursor) => {
      const container = containerRef.current;
      if (!container) return;
      const cursorY = layout.contentInsetTop + pos.line * layout.lineHeight;
      if (cursorY < container.scrollTop) {
        container.scrollTop = cursorY;
      } else if (cursorY + layout.lineHeight > container.scrollTop + container.clientHeight) {
        container.scrollTop = cursorY + layout.lineHeight - container.clientHeight;
      }
    },
    [cursor, layout.contentInsetTop, layout.lineHeight],
  );

  // 11. 在光标处插入文本
  const insertTextAtCursor = useCallback(
    (text: string) => {
      if (selection) executeSelectionDelete();
      const currentLines = [...documentLines];
      const inserted = insertTextIntoLines(currentLines, cursor, text);
      setDocumentLines(inserted.lines);
      setCursor(inserted.cursor);
      setSelection(null);

      if (path) {
        const startUtf16 = getLineStartUtf16(currentLines, cursor.line) + cursor.char;
        DocumentService.applyEdit(
          path,
          startUtf16,
          startUtf16,
          text,
          inserted.lines.join("\n"),
        ).catch(console.error);
        triggerAutocomplete(inserted.lines, inserted.cursor.line, inserted.cursor.char);
      }

      updateMaxLineLength(inserted.lines);
      setTotalLines(inserted.lines.length);
      onChange?.(inserted.lines.join("\n"));
    },
    [
      cursor,
      documentLines,
      executeSelectionDelete,
      onChange,
      path,
      selection,
      triggerAutocomplete,
      updateMaxLineLength,
    ],
  );
  insertTextAtCursorRef.current = insertTextAtCursor;

  // 12. 搜索 Hook
  const onScrollToMatch = useCallback(
    (match: EditorSearchMatch) => {
      setCursor(match);
      setSelection({
        start: match,
        end: { line: match.line, char: match.char + 1 },
      });
      scrollToCursor(match);
    },
    [scrollToCursor],
  );

  const {
    isOpen: isSearchOpen,
    query: searchQuery,
    matches: searchMatches,
    currentIndex: currentMatchIndex,
    setIsOpen: setIsSearchOpen,
    setQuery: setSearchQuery,
    next: handleSearchNext,
    prev: handleSearchPrev,
    close: handleSearchClose,
  } = useEditorSearch(documentLines, onScrollToMatch);

  const handleUndo = useCallback(() => {
    const entry = undo();
    if (!entry) return;
    const lines = entry.content.split("\n");
    const nextCursor = getCursorFromUtf16Offset(lines, entry.selectionStart);
    setDocumentLines(lines);
    setTotalLines(lines.length);
    setCursor(nextCursor);
    setSelection(null);
    updateMaxLineLength(lines);
    if (path) {
      DocumentService.applyEdit(path, 0, 0, entry.content, entry.content).catch(console.error);
    }
    onChange?.(entry.content);
  }, [onChange, path, undo, updateMaxLineLength]);

  const handleRedo = useCallback(() => {
    const entry = redo();
    if (!entry) return;
    const lines = entry.content.split("\n");
    const nextCursor = getCursorFromUtf16Offset(lines, entry.selectionStart);
    setDocumentLines(lines);
    setTotalLines(lines.length);
    setCursor(nextCursor);
    setSelection(null);
    updateMaxLineLength(lines);
    if (path) {
      DocumentService.applyEdit(path, 0, 0, entry.content, entry.content).catch(console.error);
    }
    onChange?.(entry.content);
  }, [onChange, path, redo, updateMaxLineLength]);

  // 13. 键盘按键与快捷键 Hook
  const { handleKeyDown } = useEditorKeybindings({
    language,
    documentLines,
    cursor,
    selection,
    isComposing,
    completions,
    completionIndex,
    languagePreferences,
    replaceDocumentLines,
    insertTextAtCursor,
    executeSelectionDelete,
    moveCursor,
    handleUndo,
    handleRedo,
    triggerAutocomplete,
    handleAutocompleteSelect,
    setCompletions,
    setCompletionIndex,
    setSelection,
    setCursor,
    setIsSearchOpen,
    scrollToCursor,
  });

  // 14. 剪贴板与原生操作
  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (isComposing) return;
    const text = e.currentTarget.value;
    if (text) {
      insertTextAtCursor(text);
      e.currentTarget.value = "";
    }
  };

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

  // 15. 指针交互与拖拽选择 Hook
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

  const { isDraggingRef, handleLineMouseDown } = useEditorPointerSelection({
    containerRef,
    textareaRef,
    lineElementsRef,
    documentLines,
    totalLines,
    layout,
    selection,
    setSelection,
    setCursor,
    textIndexAtPoint,
    minTextLengthIndex,
    findWordBoundaries,
    onPointerStateChange: () => {
      setCompletions([]);
      dismissHover();
    },
  });
  isDraggingPointerRef.current = isDraggingRef.current;

  const { handleContextMenuOpenChange } = useEditorContextMenu({
    textareaRef,
    setHoverContextMenuOpen,
    clearCompletions: () => setCompletions([]),
    undo: () => {
      const entry = undo();
      return entry
        ? { content: entry.content, cursor: { line: 0, char: entry.selectionStart } }
        : null;
    },
    redo: () => {
      const entry = redo();
      return entry
        ? { content: entry.content, cursor: { line: 0, char: entry.selectionStart } }
        : null;
    },
    applyHistoryState: (state) => pushHistory(state.content, state.cursor.char),
    onExecuteAction: executeEditorAction,
  });

  // 16. 同步外部内容与初始化
  useEffect(() => {
    const lines = value.split("\n");
    setDocumentLines(lines);
    setTotalLines(lines.length);
    updateMaxLineLength(lines);
  }, [value, updateMaxLineLength]);

  useEffect(() => {
    if (!externalContent) return;
    const lines = externalContent.content.split("\n");
    setDocumentLines(lines);
    setTotalLines(lines.length);
    updateMaxLineLength(lines);
  }, [externalContent, updateMaxLineLength]);

  useEffect(() => {
    if (revealLine !== undefined && revealLine > 0) {
      const targetLine = Math.min(revealLine - 1, totalLines - 1);
      setCursor({ line: targetLine, char: 0 });
      setSelection(null);
      scrollToCursor({ line: targetLine, char: 0 });
      if (path && onRevealHandled) {
        onRevealHandled(path, revealLine);
      }
    }
  }, [revealLine, totalLines, path, onRevealHandled, scrollToCursor]);

  // 17. 布局与光标物理位置计算
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateLayout = () => {
      const nextLayout = readEditorLayoutMetrics(container);
      setLayout((prev) => (sameEditorLayout(prev, nextLayout) ? prev : nextLayout));
      setViewportHeight(container.clientHeight || 500);
    };
    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const lineElement = lineElementsRef.current.get(cursor.line);
    const lineText = documentLines[cursor.line] ?? "";
    const measuredRange = lineElement
      ? measureRenderedEditorRange(lineElement, 0, cursor.char)
      : null;
    const measuredX = measuredRange !== null ? measuredRange.left + measuredRange.width : null;
    const x =
      measuredX !== null
        ? layout.contentInsetX + measuredX
        : layout.contentInsetX + measureEditorText(lineText.substring(0, cursor.char), layout);
    const y = layout.contentInsetTop + cursor.line * layout.lineHeight;
    setCaretPos({ x, y });
  }, [cursor.char, cursor.line, documentLines, layout]);

  // 18. 绑定引擎适配器
  useEffect(() => {
    if (!isActive) return;
    const severity = (val: number | undefined) => {
      if (val === 1) return "error" as const;
      if (val === 2) return "warning" as const;
      if (val === 4) return "hint" as const;
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

  // 19. 视口行渲染
  const visibleLinesDOM = useMemo(() => {
    const list = [];
    for (let idx = visibleStartIndex; idx < visibleEndIndex; idx++) {
      const lineText = documentLines[idx] ?? "";
      const isCurrent = idx === cursor.line;
      const tokens = isLargeFileMode ? largeLineTokens.get(idx) || [] : linesTokens[idx] || [];

      const lineDiags = diagnosticsForLine(diagnostics, idx, lineText.length);
      const searchLineMatches = searchMatches.filter((m: EditorSearchMatch) => m.line === idx);

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
          onLanguageHover={requestLanguageHover}
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
    requestLanguageHover,
    layout,
    textIndexAtPoint,
    registerLineElement,
    handleLineMouseDown,
    setVisibleHover,
    isDraggingRef.current,
  ]);

  // 20. 行号渲染
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
              ? "text-[var(--color-text-highlight)] font-bold opacity-100"
              : "text-[var(--color-text-muted)] opacity-60"
          }`}
          style={{ height: layout.lineHeight, lineHeight: `${layout.lineHeight}px` }}
        >
          {path && breakpoints.some((item) => item.path === path && item.line === idx + 1) && (
            <span className="absolute left-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[var(--StatusWarning)]" />
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
        .hl-token-9 { color: var(--SyntaxTypeHint, var(--color-accent)); }

        .hl-search { background-color: var(--EditorSearchMatchBg); border-bottom: 1px solid var(--EditorSearchMatchBorder); }
        .hl-search-active { background-color: var(--EditorSearchActiveBg); border-bottom: 2px solid var(--EditorSearchActiveBorder); }
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
        .hl-diag-error { text-decoration-color: var(--DiagError); }
        .hl-diag-warning { text-decoration-color: var(--DiagWarning); }
        .hl-diag-info { text-decoration-color: var(--DiagInfo); }
        .hl-diag-hint {
          text-decoration-style: dotted;
          text-decoration-color: var(--color-text-muted);
        }

        .hl-selection { background-color: var(--EditorSelectionBg) !important; }

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
            handleSearchClose();
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
        className="w-[48px] shrink-0 border-r border-[var(--EditorGutterBorder)] py-0 flex flex-col overflow-hidden select-none"
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
          closeAutocomplete();
          dismissHover();
        }}
      >
        <ContextMenuRoot onOpenChange={handleContextMenuOpenChange}>
          <ContextMenuTrigger asChild>
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
                  transform: `translateY(${gutterOffsetY}px)`,
                }}
              >
                {visibleLinesDOM}
              </div>

              {/* 逻辑绝对定位光标（重置 blink 帧） */}
              {isActive && (
                <div
                  key={`caret-${cursor.line}-${cursor.char}`}
                  className="absolute w-[2px] bg-[var(--color-accent)] editor-caret pointer-events-none z-20"
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
          <div className="pointer-events-none absolute bottom-2 right-2 z-50 rounded-lg border border-[var(--border-overlay)] bg-[var(--material-overlay)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] backdrop-blur-[var(--glass-blur-floating)]">
            {layout.fontSize}px / {layout.lineHeight}px · inset {layout.contentInsetX}px · DPR{" "}
            {layout.devicePixelRatio.toFixed(2)} · caret {caretPos.x.toFixed(1)},{" "}
            {caretPos.y.toFixed(1)}
          </div>
        )}
    </div>
  );
});
