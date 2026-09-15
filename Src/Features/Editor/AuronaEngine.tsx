import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DiagnosticsService } from "../../Core/DiagnosticsService";
import { DocumentService } from "../../Core/DocumentService";
import { EditorAdapter } from "../../Core/Editor/EditorAdapter";
import { useLocale } from "../../Foundation/I18n";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { LanguageFeaturePreferences } from "../../Foundation/Types/Config";
import type { EditorAction } from "../../Foundation/Types/Editor";
import { useDebugStore } from "../../State/useDebugStore";
import { useFeatureFlagStore } from "../../State/useFeatureFlagStore";
import {
  ContextMenuContent,
  ContextMenuDivider,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "../../UI/Components/ContextMenu";
import { BracketPairGuides } from "./Brackets/BracketPairGuides";
import { useBracketMatching } from "./Brackets/useBracketMatching";
import { AutocompleteMenu } from "./components/AutocompleteMenu";
import { EditorLine } from "./components/EditorLine";
import { HoverCard } from "./components/HoverCard";
import { SearchWidget } from "./components/SearchWidget";
import { useCodeFolding } from "./Folding/useCodeFolding";
import { GitGutterBar } from "./GitGutter/GitGutterBar";
import { useGitGutterDiff } from "./GitGutter/useGitGutterDiff";
import { useEditorAutocomplete } from "./Hooks/useEditorAutocomplete";
import { useEditorContextMenu } from "./Hooks/useEditorContextMenu";
import { diffText, useEditorHistory } from "./Hooks/useEditorHistory";
import { useEditorHover } from "./Hooks/useEditorHover";
import { useEditorIME } from "./Hooks/useEditorIME";
import { useEditorKeybindings } from "./Hooks/useEditorKeybindings";
import { useEditorPointerSelection } from "./Hooks/useEditorPointerSelection";
import {
  buildSearchRegex,
  type EditorSearchMatch,
  resolveLineReplacement,
  useEditorSearch,
} from "./Hooks/useEditorSearch";
import {
  getCursorFromUtf16Offset,
  getLineStartUtf16,
  type SelectionRange,
  useEditorSelectionOps,
} from "./Hooks/useEditorSelectionOps";
import { useSyntaxHighlighting } from "./Hooks/useSyntaxHighlighting";
import type { IEditorEngine } from "./IEditorEngine";
import { CanvasMinimap } from "./Minimap/CanvasMinimap";
import { collectMinimapDecorations } from "./Minimap/MinimapDecorations";
import { MultiCursorCaretLayer } from "./MultiCursor/MultiCursorCaretLayer";
import { useMultiCursorOps } from "./MultiCursor/useMultiCursorOps";
import { useSelectionOccurrence } from "./MultiCursor/useSelectionOccurrence";
import { useEditorViewport } from "./Performance/useEditorViewport";
import {
  DEFAULT_EDITOR_LAYOUT,
  editorTextIndexAtX,
  editorTextIndexFromPoint,
  measureEditorText,
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
  externalContent?: { content: string; nonce: number } | null;
};

const DEFAULT_PREFS: Required<LanguageFeaturePreferences> = {
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
  const { t } = useLocale();
  const toggleBreakpoint = useDebugStore((state) => state.toggleBreakpoint);
  const isMinimapEnabled = useFeatureFlagStore((s) => s.isFeatureEnabled("editor.minimap"));
  const isBracketGuideEnabled = useFeatureFlagStore((s) =>
    s.isFeatureEnabled("editor.bracketPairColorization"),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineElementsRef = useRef(new Map<number, HTMLButtonElement>());

  // 1. 文档核心数据
  const [documentLines, setDocumentLines] = useState<string[]>([""]);
  const [totalLines, setTotalLines] = useState(1);
  const [maxLineLength, setMaxLineLength] = useState(1);
  const [layout, setLayout] = useState(DEFAULT_EDITOR_LAYOUT);
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

  const registerLineElement = useCallback(
    (lineIndex: number, element: HTMLButtonElement | null) => {
      if (element) lineElementsRef.current.set(lineIndex, element);
      else lineElementsRef.current.delete(lineIndex);
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

  // 2. 硬件 RAF 滚动与视口管理 (Performance)
  const {
    scrollTop,
    viewportHeight,
    visibleStartIndex,
    visibleEndIndex,
    gutterOffsetY,
    handleScroll,
    scrollToLine,
  } = useEditorViewport({
    totalLines,
    layout,
    containerRef,
  });

  // 3. 历史栈管理
  const { undo, redo, pushHistory, pushComposite, syncExternal } = useEditorHistory(value);

  // 4. 选区操作 Hook
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
    onEditCommitted: (content, cursorUtf16) => pushHistory(content, cursorUtf16),
  });

  // 5. 语言偏好设置与诊断
  const [languagePreferences, setLanguagePreferences] =
    useState<Required<LanguageFeaturePreferences>>(DEFAULT_PREFS);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);

  useEffect(() => {
    UserConfigStore.get()
      .then((cfg) => {
        if (cfg.languageFeatures) {
          setLanguagePreferences({
            hoverEnabled: cfg.languageFeatures.hoverEnabled ?? DEFAULT_PREFS.hoverEnabled,
            hoverDelayMs: cfg.languageFeatures.hoverDelayMs ?? DEFAULT_PREFS.hoverDelayMs,
            automaticCompletion:
              cfg.languageFeatures.automaticCompletion ?? DEFAULT_PREFS.automaticCompletion,
          });
        }
      })
      .catch(() => undefined);
  }, []);

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
    return DiagnosticsService.subscribe(() => setDiagnostics(mapDiags()));
  }, [path]);

  // 6. 语法高亮
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

  // 7. 代码折叠系统 (Folding)
  const { foldableRanges, foldedStartLines, toggleFold } = useCodeFolding(documentLines);

  // 8. 彩虹括号与作用域引导线 (Brackets)
  const { activeMatchedPair } = useBracketMatching(documentLines, cursor);

  // 9. 多光标编辑与相同标识符全高亮 (MultiCursor)
  const {
    extras,
    extraCursors,
    addCursor,
    clearExtraCursors,
    selectNextOccurrence,
    replaceExtras,
  } = useMultiCursorOps(documentLines);
  const occurrences = useSelectionOccurrence(documentLines, selection);

  // 10. Git Gutter 差异 (GitGutter)
  const gitGutterDiff = useGitGutterDiff(path);

  // 11. 文档更新与同步
  // 精确写盘：计算旧内容到新内容的单连续差异区间，只把差异段传给 Rust，
  // 避免 Backspace/Delete/Enter/行操作等按键路径整文序列化重建 rope。
  const applyContentDiff = useCallback(
    (currentContent: string, nextContent: string) => {
      if (!path) return;
      const difference = diffText(currentContent, nextContent);
      DocumentService.applyEdit(
        path,
        difference.startUtf16,
        difference.startUtf16 + difference.deletedText.length,
        difference.insertedText,
        nextContent,
      ).catch((error) => {
        onSyncError?.(error instanceof Error ? error : new Error(String(error)));
      });
    },
    [onSyncError, path],
  );

  // 统一编辑提交点：状态更新 + 撤销入栈 + IPC 落盘，所有编辑路径（按键/IME/替换）都经此提交
  const commitEdit = useCallback(
    (
      nextLines: string[],
      nextCursor: { line: number; char: number },
      nextSelection: SelectionRange | null = null,
    ) => {
      const currentContent = documentLines.join("\n");
      const nextContent = nextLines.join("\n");
      setDocumentLines(nextLines);
      setTotalLines(nextLines.length);
      setCursor(nextCursor);
      setSelection(nextSelection);
      updateMaxLineLength(nextLines);
      pushHistory(nextContent, getLineStartUtf16(nextLines, nextCursor.line) + nextCursor.char);
      applyContentDiff(currentContent, nextContent);
      onChange?.(nextContent);
    },
    [applyContentDiff, documentLines, onChange, pushHistory, updateMaxLineLength],
  );

  // 按键类编辑入口（Backspace/Delete/Enter/Tab/行操作等 keybinding 路径）
  const replaceDocumentLines = commitEdit;

  // 12. Hover 与自动补全
  const isDraggingPointerRef = useRef(false);
  const [isContextMenuOpen, setHoverContextMenuOpen] = useState(false);
  // 多光标批量插入转发 ref：insertTextAtCursor 定义在前，批量路径定义在后
  const multiCursorInsertRef = useRef<((text: string) => void) | null>(null);
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

  const singleCharWidth = useMemo(() => measureEditorText("M", layout), [layout]);
  // 候选框锚点：按实际前缀文本测量，宽字符/CJK 不再漂移（textarea 代理与补全面板共用）
  const caretPos = useMemo(
    () => ({
      x:
        layout.contentInsetX +
        measureEditorText((documentLines[cursor.line] || "").substring(0, cursor.char), layout),
      y: layout.contentInsetTop + cursor.line * layout.lineHeight,
    }),
    [cursor.char, cursor.line, documentLines, layout.contentInsetTop, layout.contentInsetX, layout],
  );

  // 光标可见性保障：光标移动或编辑后确保主光标行完整位于视口内（纵向行级、横向按实际前缀宽度）
  const ensureCursorVisible = useCallback(
    (pos: { line: number; char: number }) => {
      const container = containerRef.current;
      if (!container) return;
      const lineTop = layout.contentInsetTop + pos.line * layout.lineHeight;
      if (lineTop < container.scrollTop) {
        container.scrollTop = Math.max(0, lineTop);
      } else if (lineTop + layout.lineHeight > container.scrollTop + container.clientHeight) {
        container.scrollTop = lineTop + layout.lineHeight - container.clientHeight;
      }
      const caretX =
        layout.contentInsetX +
        measureEditorText((documentLines[pos.line] || "").substring(0, pos.char), layout);
      const viewLeft = container.scrollLeft;
      const viewRight = viewLeft + container.clientWidth;
      if (caretX < viewLeft + layout.contentInsetX) {
        container.scrollLeft = Math.max(0, caretX - layout.contentInsetX);
      } else if (caretX > viewRight - 24) {
        container.scrollLeft = caretX - container.clientWidth + layout.contentInsetX + 24;
      }
    },
    [documentLines, layout],
  );

  // 任何光标变化后自动保障可见（编辑/导航/撤销/替换等所有路径统一覆盖）
  useEffect(() => {
    ensureCursorVisible(cursor);
  }, [cursor, ensureCursorVisible]);

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

  const getSelectionText = useCallback((): string => {
    if (!selection) return "";
    const { start, end } = sortSelection(selection);
    if (start.line === end.line) {
      return (documentLines[start.line] || "").substring(start.char, end.char);
    }
    const result: string[] = [(documentLines[start.line] || "").substring(start.char)];
    for (let i = start.line + 1; i < end.line; i++) result.push(documentLines[i] || "");
    result.push((documentLines[end.line] || "").substring(0, end.char));
    return result.join("\n");
  }, [documentLines, selection]);

  const insertTextAtCursor = useCallback(
    (text: string) => {
      // 多光标批量插入：每个光标/选区插入相同文本，一步撤销（批量路径定义在后，经 ref 转发）
      if (extraCursors.length > 0 && multiCursorInsertRef.current) {
        multiCursorInsertRef.current(text);
        return;
      }
      if (selection) {
        // 选中状态：删除选区并在选区起点插入，一次合并提交（单步撤销）。
        // 不能依赖 executeSelectionDelete 的异步 setState——后续计算会拿到删除前的行。
        const { start, end } = sortSelection(selection);
        const nextLines = [...documentLines];
        const startLineText = nextLines[start.line] || "";
        const endLineText = nextLines[end.line] || "";
        nextLines.splice(
          start.line,
          end.line - start.line + 1,
          startLineText.substring(0, start.char) + text + endLineText.substring(end.char),
        );
        const nextCursor = { line: start.line, char: start.char + text.length };
        const nextContent = nextLines.join("\n");

        setDocumentLines(nextLines);
        setTotalLines(nextLines.length);
        setCursor(nextCursor);
        setSelection(null);
        updateMaxLineLength(nextLines);
        pushHistory(nextContent, getLineStartUtf16(nextLines, nextCursor.line) + nextCursor.char);
        if (path) {
          const startUtf16 = getLineStartUtf16(documentLines, start.line) + start.char;
          const endUtf16 = getLineStartUtf16(documentLines, end.line) + end.char;
          DocumentService.applyEdit(path, startUtf16, endUtf16, text, nextContent).catch(
            (error) => {
              onSyncError?.(error instanceof Error ? error : new Error(String(error)));
            },
          );
        }
        triggerAutocomplete(nextLines, nextCursor.line, nextCursor.char);
        onChange?.(nextContent);
        return;
      }

      const currentLines = [...documentLines];
      const inserted = insertTextIntoLines(currentLines, cursor, text);
      const insertedContent = inserted.lines.join("\n");
      setDocumentLines(inserted.lines);
      setCursor(inserted.cursor);
      setSelection(null);

      pushHistory(
        insertedContent,
        getLineStartUtf16(inserted.lines, inserted.cursor.line) + inserted.cursor.char,
      );

      if (path) {
        const startUtf16 = getLineStartUtf16(currentLines, cursor.line) + cursor.char;
        DocumentService.applyEdit(path, startUtf16, startUtf16, text, insertedContent).catch(
          (error) => {
            onSyncError?.(error instanceof Error ? error : new Error(String(error)));
          },
        );
        triggerAutocomplete(inserted.lines, inserted.cursor.line, inserted.cursor.char);
      }

      updateMaxLineLength(inserted.lines);
      setTotalLines(inserted.lines.length);
      onChange?.(insertedContent);
    },
    [
      cursor,
      documentLines,
      extraCursors,
      onChange,
      onSyncError,
      path,
      pushHistory,
      selection,
      triggerAutocomplete,
      updateMaxLineLength,
    ],
  );
  insertTextAtCursorRef.current = insertTextAtCursor;

  // 13. 搜索与撤销重做
  const onScrollToMatch = useCallback(
    (match: EditorSearchMatch) => {
      setCursor(match);
      setSelection({ start: match, end: { line: match.line, char: match.char + 1 } });
      scrollToLine(match.line);
    },
    [scrollToLine],
  );

  const {
    isOpen: isSearchOpen,
    query: searchQuery,
    options: searchOptions,
    setOptions: setSearchOptions,
    matches: searchMatches,
    currentIndex: currentMatchIndex,
    setIsOpen: setIsSearchOpen,
    setQuery: setSearchQuery,
    markReplacementAnchor,
    next: handleSearchNext,
    prev: handleSearchPrev,
    close: handleSearchClose,
  } = useEditorSearch(documentLines, onScrollToMatch);

  // 搜索替换：与 undo/redo 相同的落盘与同步路径
  const [replaceValue, setReplaceValue] = useState("");
  const invalidSearchQuery =
    searchQuery !== "" && buildSearchRegex(searchQuery, searchOptions) === null;

  const applyReplacedContent = useCallback(
    (nextContent: string) => {
      const nextLines = nextContent.split("\n");
      commitEdit(nextLines, cursor, selection);
    },
    [commitEdit, cursor, selection],
  );

  const handleReplaceCurrent = useCallback(() => {
    const match = searchMatches[currentMatchIndex];
    if (!match) return;
    const line = documentLines[match.line] ?? "";
    const replacement = resolveLineReplacement(
      line,
      match,
      searchQuery,
      replaceValue,
      searchOptions,
    );
    const nextLine =
      line.slice(0, match.char) + replacement + line.slice(match.char + match.length);
    const nextLines = [...documentLines];
    nextLines[match.line] = nextLine;
    // 替换后继续搜索的位置：替换起点 + 新文本长度
    markReplacementAnchor(match.line, match.char + replacement.length);
    applyReplacedContent(nextLines.join("\n"));
  }, [
    applyReplacedContent,
    currentMatchIndex,
    documentLines,
    markReplacementAnchor,
    replaceValue,
    searchOptions,
    searchQuery,
    searchMatches,
  ]);

  const handleReplaceAll = useCallback(() => {
    if (searchMatches.length === 0) return;
    // 命中按 (line, char) 升序：逐行从后向前替换，保持索引稳定；正则替换逐命中展开捕获组
    const nextLines = documentLines.map((line, lineIndex) => {
      const lineMatches = searchMatches.filter((m) => m.line === lineIndex);
      if (lineMatches.length === 0) return line;
      let result = line;
      for (let i = lineMatches.length - 1; i >= 0; i--) {
        const match = lineMatches[i];
        const replacement = resolveLineReplacement(
          line,
          match,
          searchQuery,
          replaceValue,
          searchOptions,
        );
        result =
          result.slice(0, match.char) + replacement + result.slice(match.char + match.length);
      }
      return result;
    });
    applyReplacedContent(nextLines.join("\n"));
  }, [
    applyReplacedContent,
    documentLines,
    replaceValue,
    searchMatches,
    searchOptions,
    searchQuery,
  ]);

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
    applyContentDiff(documentLines.join("\n"), entry.content);
    onChange?.(entry.content);
  }, [applyContentDiff, documentLines, onChange, undo, updateMaxLineLength]);

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
    applyContentDiff(documentLines.join("\n"), entry.content);
    onChange?.(entry.content);
  }, [applyContentDiff, documentLines, onChange, redo, updateMaxLineLength]);

  // 14. 多光标批量编辑：内存合并 + 一次降序批量 IPC + composite 一步撤销
  const commitMultiCursorEdits = useCallback(
    (
      ranges: {
        start: { line: number; char: number };
        end: { line: number; char: number };
        text: string;
        isPrimary: boolean;
        cursorOffsetInText: number;
      }[],
    ) => {
      if (ranges.length === 0) return;
      const originalContent = documentLines.join("\n");
      const withOffsets = ranges.map((range) => ({
        ...range,
        startUtf16: getLineStartUtf16(documentLines, range.start.line) + range.start.char,
        endUtf16: getLineStartUtf16(documentLines, range.end.line) + range.end.char,
      }));
      // 降序排列：坐标互不重叠时在中间文档上依然正确
      withOffsets.sort((a, b) => b.startUtf16 - a.startUtf16);
      const applied: typeof withOffsets = [];
      let lastStart = Number.MAX_SAFE_INTEGER;
      for (const item of withOffsets) {
        // 与右侧已应用区间重叠（如重复光标）：防御性跳过
        if (item.endUtf16 > lastStart) continue;
        applied.push(item);
        lastStart = item.startUtf16;
      }
      if (applied.length === 0) return;

      let nextContent = originalContent;
      for (const item of applied) {
        nextContent =
          nextContent.slice(0, item.startUtf16) + item.text + nextContent.slice(item.endUtf16);
      }
      const nextLines = nextContent.split("\n");

      // 新光标：extras 按原位置升序重建；被跳过的区间光标保持原位
      const skipped = withOffsets.filter((item) => !applied.includes(item));
      const primary = applied.find((item) => item.isPrimary);
      const extraEdits = applied.filter((item) => !item.isPrimary);
      const nextExtras = [
        ...extraEdits
          .sort((a, b) => a.startUtf16 - b.startUtf16)
          .map((item) => ({
            cursor: getCursorFromUtf16Offset(nextLines, item.startUtf16 + item.cursorOffsetInText),
            selection: null,
          })),
        ...skipped
          .filter((item) => !item.isPrimary)
          .sort((a, b) => a.startUtf16 - b.startUtf16)
          .map((item) => ({ cursor: item.start, selection: null })),
      ];

      setDocumentLines(nextLines);
      setTotalLines(nextLines.length);
      if (primary) {
        setCursor(
          getCursorFromUtf16Offset(nextLines, primary.startUtf16 + primary.cursorOffsetInText),
        );
        setSelection(null);
      }
      replaceExtras(nextExtras);
      updateMaxLineLength(nextLines);

      const primaryCursorUtf16 = primary
        ? primary.startUtf16 + primary.cursorOffsetInText
        : getLineStartUtf16(nextLines, cursor.line) + cursor.char;
      pushComposite(
        applied.map((item) => ({
          startUtf16: item.startUtf16,
          deletedText: originalContent.slice(item.startUtf16, item.endUtf16),
          insertedText: item.text,
        })),
        primaryCursorUtf16,
        nextContent,
      );

      if (path) {
        DocumentService.applyEdits(
          path,
          applied.map((item) => ({
            startUtf16: item.startUtf16,
            endUtf16: item.endUtf16,
            text: item.text,
          })),
          nextContent,
        ).catch((error) => {
          onSyncError?.(error instanceof Error ? error : new Error(String(error)));
        });
      }
      if (primary) {
        triggerAutocomplete(
          nextLines,
          getCursorFromUtf16Offset(nextLines, primaryCursorUtf16).line,
          getCursorFromUtf16Offset(nextLines, primaryCursorUtf16).char,
        );
      }
      onChange?.(nextContent);
    },
    [
      cursor,
      documentLines,
      onChange,
      onSyncError,
      path,
      pushComposite,
      replaceExtras,
      triggerAutocomplete,
      updateMaxLineLength,
    ],
  );

  // 收集主光标 + 额外光标的编辑区间（点或选区）
  const collectMultiCursorRanges = useCallback(() => {
    const ranges: {
      start: { line: number; char: number };
      end: { line: number; char: number };
      isPrimary: boolean;
    }[] = [];
    if (selection) {
      const sorted = sortSelection(selection);
      ranges.push({ start: sorted.start, end: sorted.end, isPrimary: true });
    } else {
      ranges.push({ start: cursor, end: cursor, isPrimary: true });
    }
    extras.forEach((item) => {
      if (item.selection) {
        const sorted = sortSelection(item.selection);
        ranges.push({ start: sorted.start, end: sorted.end, isPrimary: false });
      } else {
        ranges.push({ start: item.cursor, end: item.cursor, isPrimary: false });
      }
    });
    return ranges;
  }, [cursor, extras, selection]);

  const handleMultiCursorInsert = useCallback(
    (text: string) => {
      commitMultiCursorEdits(
        collectMultiCursorRanges().map((range) => ({
          ...range,
          text,
          cursorOffsetInText: text.length,
        })),
      );
    },
    [collectMultiCursorRanges, commitMultiCursorEdits],
  );
  multiCursorInsertRef.current = handleMultiCursorInsert;

  const handleMultiCursorBackspace = useCallback(() => {
    const ranges = collectMultiCursorRanges().map((range) => {
      if (range.start.line === range.end.line && range.start.char === range.end.char) {
        if (range.start.char > 0) {
          return {
            ...range,
            start: { line: range.start.line, char: range.start.char - 1 },
            text: "",
            cursorOffsetInText: 0,
          };
        }
        if (range.start.line > 0) {
          // 行首退格：与前一行合并（删除换行符）
          const prevLength = (documentLines[range.start.line - 1] || "").length;
          return {
            ...range,
            start: { line: range.start.line - 1, char: prevLength },
            text: "",
            cursorOffsetInText: 0,
          };
        }
        // 文档起点无处可删：零宽无操作，光标保持
        return { ...range, text: "", cursorOffsetInText: 0 };
      }
      return { ...range, text: "", cursorOffsetInText: 0 };
    });
    commitMultiCursorEdits(ranges);
  }, [collectMultiCursorRanges, commitMultiCursorEdits, documentLines]);

  const handleMultiCursorDelete = useCallback(() => {
    const ranges = collectMultiCursorRanges().map((range) => {
      if (range.start.line === range.end.line && range.start.char === range.end.char) {
        const lineText = documentLines[range.end.line] || "";
        if (range.end.char < lineText.length) {
          return {
            ...range,
            end: { line: range.end.line, char: range.end.char + 1 },
            text: "",
            cursorOffsetInText: 0,
          };
        }
        if (range.end.line < documentLines.length - 1) {
          // 行尾删除：与下一行合并
          return {
            ...range,
            end: { line: range.end.line + 1, char: 0 },
            text: "",
            cursorOffsetInText: 0,
          };
        }
        return { ...range, text: "", cursorOffsetInText: 0 };
      }
      return { ...range, text: "", cursorOffsetInText: 0 };
    });
    commitMultiCursorEdits(ranges);
  }, [collectMultiCursorRanges, commitMultiCursorEdits, documentLines]);

  const handleMultiCursorEnter = useCallback(() => {
    commitMultiCursorEdits(
      collectMultiCursorRanges().map((range) => {
        const lineText = documentLines[range.start.line] || "";
        const indent = lineText.match(/^(\s*)/)?.[1] ?? "";
        const insert = `\n${indent}`;
        return { ...range, text: insert, cursorOffsetInText: insert.length };
      }),
    );
  }, [collectMultiCursorRanges, commitMultiCursorEdits, documentLines]);

  // 15. 快捷键与剪贴板
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
    scrollToCursor: (pos) => scrollToLine(pos?.line ?? cursor.line),
    pageLines: Math.max(1, Math.floor(viewportHeight / layout.lineHeight) - 1),
    extraCursorCount: extraCursors.length,
    handleCtrlD: () => {
      const result = selectNextOccurrence(cursor, selection, findWordBoundaries);
      if (result) {
        setSelection(result.newPrimarySelection);
        setCursor(result.newPrimaryCursor);
      }
    },
    clearExtraCursors,
    handleMultiCursorBackspace,
    handleMultiCursorDelete,
    handleMultiCursorEnter,
  });

  const handleCut = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const selText = getSelectionText();
    if (selText && selection) {
      e.clipboardData.setData("text/plain", selText);
      executeSelectionDelete();
    }
  };

  const handleCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.clipboardData.setData(
      "text/plain",
      getSelectionText() || `${documentLines[cursor.line] || ""}\n`,
    );
  };

  const executeEditorAction = useCallback(
    (action: EditorAction) => {
      textareaRef.current?.focus();
      if (action === "undo") handleUndo();
      else if (action === "redo") handleRedo();
      else if (action === "cut" && selection) executeSelectionDelete();
      else if (action === "selectAll") {
        setSelection({
          start: { line: 0, char: 0 },
          end: {
            line: documentLines.length - 1,
            char: documentLines[documentLines.length - 1].length,
          },
        });
      }
    },
    [documentLines, executeSelectionDelete, handleRedo, handleUndo, selection],
  );

  // 15. 指针交互
  const minTextLengthIndex = useCallback(
    (text: string, relativeX: number) => editorTextIndexAtX(text, relativeX, layout),
    [layout],
  );

  const textIndexAtPoint = useCallback(
    (lineIndex: number, lineElement: HTMLButtonElement, clientX: number, clientY: number) => {
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
    onExecuteAction: executeEditorAction,
  });

  // 16. 同步外部内容与初始化
  useEffect(() => {
    const lines = value.split("\n");
    setDocumentLines(lines);
    setTotalLines(lines.length);
    updateMaxLineLength(lines);
    syncExternal(value);
  }, [value, syncExternal, updateMaxLineLength]);

  useEffect(() => {
    if (!externalContent) return;
    const lines = externalContent.content.split("\n");
    setDocumentLines(lines);
    setTotalLines(lines.length);
    updateMaxLineLength(lines);
    syncExternal(externalContent.content);
  }, [externalContent, syncExternal, updateMaxLineLength]);

  useEffect(() => {
    if (revealLine !== undefined && revealLine > 0) {
      const targetLine = Math.min(revealLine - 1, totalLines - 1);
      setCursor({ line: targetLine, char: 0 });
      setSelection(null);
      scrollToLine(targetLine);
      if (path && onRevealHandled) onRevealHandled(path, revealLine);
    }
  }, [revealLine, totalLines, path, onRevealHandled, scrollToLine]);

  useLayoutEffect(() => {
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
  }, []);

  // 17. 引擎适配器桥接
  useEffect(() => {
    if (!isActive) return;
    const engine: IEditorEngine = {
      getText: () => documentLines.join("\n"),
      getSelectionText,
      insertCode: insertTextAtCursor,
      replaceRange: (startLine, endLine, newText) => {
        const first = Math.max(0, startLine - 1);
        const last = Math.min(documentLines.length - 1, Math.max(first, endLine - 1));
        const next = [...documentLines];
        next.splice(first, last - first + 1, ...newText.split("\n"));
        setDocumentLines(next);
        setTotalLines(next.length);
        onChange?.(next.join("\n"));
      },
      revealLine: (line) => {
        if (!Number.isFinite(line) || line < 1) return;
        const target = Math.min(Math.trunc(line) - 1, totalLines - 1);
        scrollToLine(Math.max(0, target));
      },
      getStatus: () => ({
        hasEditor: true,
        path,
        language,
        line: cursor.line + 1,
        column: cursor.char + 1,
        selectionLength: getSelectionText().length,
        tabSize: layout.tabSize,
        insertSpaces: true,
        encoding: "UTF-8",
        lineEnding: "LF",
        errors: diagnostics.filter((d) => d.severity === 1).length,
        warnings: diagnostics.filter((d) => d.severity === 2).length,
        markers: [],
      }),
      onStatusChange: (l) => {
        l(engine.getStatus());
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
    layout.tabSize,
    onChange,
    path,
    scrollToLine,
    totalLines,
  ]);

  // 18. Minimap 装饰标记计算
  const minimapDecorations = useMemo(() => {
    return collectMinimapDecorations(diagnostics, searchMatches, selection);
  }, [diagnostics, searchMatches, selection]);

  // 19. 视口行渲染
  const visibleLinesDOM = useMemo(() => {
    const list = [];
    for (let idx = visibleStartIndex; idx < visibleEndIndex; idx++) {
      const lineText = documentLines[idx] ?? "";
      const isCurrent = idx === cursor.line;
      const tokens = isLargeFileMode ? largeLineTokens.get(idx) || [] : linesTokens[idx] || [];
      const lineDiags = diagnosticsForLine(diagnostics, idx, lineText.length);
      const searchLineMatches = searchMatches.filter((m: EditorSearchMatch) => m.line === idx);
      const isFoldedStart = foldedStartLines.has(idx);

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
          onMouseDown={(idx, e) => {
            // Alt+Click：添加额外光标
            if (e.altKey && e.button === 0) {
              const charIndex = textIndexAtPoint(idx, e.currentTarget, e.clientX, e.clientY);
              addCursor({ line: idx, char: charIndex });
              textareaRef.current?.focus();
              e.preventDefault();
              return;
            }
            // 常规指针交互：清除额外光标
            if (extraCursors.length > 0) clearExtraCursors();
            handleLineMouseDown(idx, e);
          }}
          onMouseLeave={handleLineMouseLeave}
          onLanguageHover={requestLanguageHover}
          textIndexAtPoint={textIndexAtPoint}
          registerLineElement={registerLineElement}
          isComposing={isComposing}
          compositionText={compositionText}
          compositionChar={cursor.char}
          layout={layout}
          isFoldedStart={isFoldedStart}
          onToggleFold={toggleFold}
          occurrences={occurrences}
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
    diagnostics,
    searchMatches,
    foldedStartLines,
    searchQuery,
    currentMatchIndex,
    selection,
    setVisibleHover,
    handleLineMouseDown,
    handleLineMouseLeave,
    requestLanguageHover,
    textIndexAtPoint,
    registerLineElement,
    isComposing,
    compositionText,
    cursor.char,
    layout,
    toggleFold,
    occurrences,
    isDraggingRef.current,
    addCursor,
    extraCursors,
    clearExtraCursors,
  ]);

  // 20. 行号与折叠三角
  const lineNumbersDOM = useMemo(() => {
    const list = [];
    for (let idx = visibleStartIndex; idx < visibleEndIndex; idx++) {
      const isCurrent = idx === cursor.line;
      const isFoldable = foldableRanges.some((r) => r.startLine === idx);
      const isFolded = foldedStartLines.has(idx);

      list.push(
        <div
          key={idx}
          className="group/line relative w-full flex items-center justify-between px-1.5 select-none"
          style={{ height: layout.lineHeight, lineHeight: `${layout.lineHeight}px` }}
        >
          {/* 折叠触发三角 */}
          {isFoldable ? (
            <button
              type="button"
              onClick={() => toggleFold(idx)}
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-highlight)] transition-transform"
            >
              {isFolded ? "▶" : "▼"}
            </button>
          ) : (
            <span className="w-2.5" />
          )}

          <button
            type="button"
            onClick={() => {
              if (path) toggleBreakpoint(path, idx + 1);
            }}
            className={`flex-1 text-right pr-2 font-mono text-[12px] ${
              isCurrent
                ? "text-[var(--color-text-highlight)] font-bold"
                : "text-[var(--color-text-muted)] opacity-60"
            }`}
          >
            {idx + 1}
          </button>

          {/* Git 边栏指示条 */}
          <GitGutterBar
            isAdded={gitGutterDiff.addedLines.has(idx)}
            isModified={gitGutterDiff.modifiedLines.has(idx)}
            isDeleted={gitGutterDiff.deletedLines.has(idx)}
          />
        </div>,
      );
    }
    return list;
  }, [
    visibleStartIndex,
    visibleEndIndex,
    cursor.line,
    foldableRanges,
    foldedStartLines,
    layout.lineHeight,
    toggleFold,
    path,
    toggleBreakpoint,
    gitGutterDiff,
  ]);

  return (
    <div
      className="relative w-full h-full flex bg-transparent overflow-hidden"
      data-editor-font={layout.fontFamily}
      data-editor-font-size={layout.fontSize}
      data-editor-line-height={layout.lineHeight}
    >
      {/* 词法高亮与动画 CSS */}
      <style>{`
        .hl-token-1 { color: var(--SyntaxKeyword, #c084fc); font-weight: bold; }
        .hl-token-2 { color: var(--SyntaxString, #4ade80); }
        .hl-token-3 { color: var(--SyntaxNumber, #f59e0b); }
        .hl-token-4 { color: var(--SyntaxFunction, #60a5fa); }
        .hl-token-5 { color: var(--SyntaxVariable, #e2e8f0); }
        .hl-token-6 { color: var(--SyntaxComment, #64748b); font-style: italic; }
        .hl-token-7 { color: var(--SyntaxOperator, #94a3b8); }
        .hl-token-8 { color: var(--SyntaxBuiltin, #38bdf8); }
        .hl-token-9 { color: var(--SyntaxTypeHint, var(--color-accent)); }

        .hl-bracket-0 { color: #f59e0b; }
        .hl-bracket-1 { color: #c084fc; }
        .hl-bracket-2 { color: #38bdf8; }
        .hl-bracket-3 { color: #4ade80; }
        .hl-bracket-4 { color: #f43f5e; }
        .hl-bracket-5 { color: #e2e8f0; }

        .hl-occurrence { background-color: color-mix(in srgb, var(--color-accent) 12%, transparent); border-radius: 2px; }
        .hl-search { background-color: var(--EditorSearchMatchBg, rgba(245, 158, 11, 0.3)); }
        .hl-search-active { background-color: var(--EditorSearchActiveBg, rgba(245, 158, 11, 0.7)); }

        .hl-diag-error { text-decoration: underline wavy var(--DiagError, #ef4444); }
        .hl-diag-warning { text-decoration: underline wavy var(--DiagWarning, #f59e0b); }
        .hl-selection { background-color: var(--EditorSelectionBg) !important; }

        @keyframes caret-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        .editor-caret { animation: caret-blink 1s step-end infinite; }
      `}</style>

      {isSearchOpen && (
        <SearchWidget
          onSearch={setSearchQuery}
          onClose={() => {
            handleSearchClose();
            setReplaceValue("");
            textareaRef.current?.focus();
          }}
          onNext={handleSearchNext}
          onPrev={handleSearchPrev}
          totalMatches={searchMatches.length}
          currentIndex={currentMatchIndex}
          options={searchOptions}
          onOptionsChange={setSearchOptions}
          invalidQuery={invalidSearchQuery}
          replaceValue={replaceValue}
          onReplaceValueChange={setReplaceValue}
          onReplace={handleReplaceCurrent}
          onReplaceAll={handleReplaceAll}
        />
      )}

      {/* 侧边行号与折叠 Gutter */}
      <div
        className="w-[52px] shrink-0 border-r border-[var(--EditorGutterBorder)] py-0 flex flex-col overflow-hidden select-none"
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
          handleScroll(e);
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
                width: `${maxLineLength * singleCharWidth + 200}px`,
                minWidth: "100%",
              }}
            >
              {/* 垂直作用域引导线 */}
              {isBracketGuideEnabled && (
                <BracketPairGuides
                  activePair={activeMatchedPair}
                  lineHeight={layout.lineHeight}
                  charWidth={singleCharWidth}
                  contentInsetX={layout.contentInsetX}
                  contentInsetTop={layout.contentInsetTop}
                />
              )}

              {/* 虚拟行 DOM */}
              <div
                className="absolute left-0 w-full"
                style={{ transform: `translateY(${gutterOffsetY}px)` }}
              >
                {visibleLinesDOM}
              </div>

              {/* 主光标与多光标平滑动画层 */}
              <MultiCursorCaretLayer
                primaryCursor={cursor}
                extras={extras}
                lineHeight={layout.lineHeight}
                charWidth={singleCharWidth}
                contentInsetX={layout.contentInsetX}
                contentInsetTop={layout.contentInsetTop}
                isActive={isActive}
              />

              {/* 隐藏代理 Textarea */}
              <textarea
                ref={textareaRef}
                onKeyDown={handleKeyDown}
                onInput={(e) => {
                  if (!isComposing && e.currentTarget.value) {
                    insertTextAtCursor(e.currentTarget.value);
                    e.currentTarget.value = "";
                  }
                }}
                onCompositionStart={handleCompositionStart}
                onCompositionUpdate={handleCompositionUpdate}
                onCompositionEnd={handleCompositionEnd}
                onCopy={handleCopy}
                onCut={handleCut}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = normalizeEditorText(e.clipboardData.getData("text/plain"));
                  if (text) insertTextAtCursor(text);
                }}
                className="absolute opacity-0 pointer-events-none w-1 h-1 z-30"
                style={{ top: `${caretPos.y}px`, left: `${caretPos.x}px` }}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-64">
            <ContextMenuItem label={t("editor.contextUndo")} onSelect={handleUndo} />
            <ContextMenuItem label={t("editor.contextRedo")} onSelect={handleRedo} />
            <ContextMenuDivider />
            <ContextMenuItem
              label={t("editor.contextCut")}
              onSelect={() => executeEditorAction("cut")}
            />
            <ContextMenuItem
              label={t("editor.contextCopy")}
              onSelect={() => executeEditorAction("copy")}
            />
            <ContextMenuItem
              label={t("editor.contextPaste")}
              onSelect={() => navigator.clipboard.readText().then(insertTextAtCursor)}
            />
            <ContextMenuDivider />
            <ContextMenuItem
              label={t("editor.contextSelectAll")}
              onSelect={() => executeEditorAction("selectAll")}
            />
          </ContextMenuContent>
        </ContextMenuRoot>
      </div>

      {/* 右侧高性能 Canvas 2D Minimap 代码小地图 */}
      {isMinimapEnabled && (
        <CanvasMinimap
          documentLines={documentLines}
          linesTokens={linesTokens}
          totalLines={totalLines}
          scrollTop={scrollTop}
          viewportHeight={viewportHeight}
          lineHeight={layout.lineHeight}
          decorations={minimapDecorations}
          onScrollTo={(targetY) => {
            if (containerRef.current) containerRef.current.scrollTop = targetY;
          }}
        />
      )}

      {/* 智能补全与诊断 Tooltip */}
      {completions.length > 0 && (
        <AutocompleteMenu
          x={completionPos.x}
          y={completionPos.y}
          items={completions}
          selectedIndex={completionIndex}
          onSelect={handleAutocompleteSelect}
        />
      )}
      {hoverTooltip && !isContextMenuOpen && (
        <HoverCard
          hover={hoverTooltip}
          onMouseEnter={handleHoverEnter}
          onMouseLeave={handleHoverLeave}
        />
      )}
    </div>
  );
});
