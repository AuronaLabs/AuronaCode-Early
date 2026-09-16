import React, { useCallback, useEffect, useRef, useState } from "react";
import { DiagnosticsService } from "../../Core/DiagnosticsService";
import { EditorAdapter } from "../../Core/Editor/EditorAdapter";
import { useLocale } from "../../Foundation/I18n";
import { EventBus } from "../../Foundation/EventBus";
import { UserConfigStore } from "../../Foundation/Storage/UserConfigStore";
import type { LanguageFeaturePreferences } from "../../Foundation/Types/Config";
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
import { HoverCard } from "./components/HoverCard";
import { SearchWidget } from "./components/SearchWidget";
import { useCodeFolding } from "./Folding/useCodeFolding";
import { useGitGutterDiff } from "./GitGutter/useGitGutterDiff";
import { useEditorCommit } from "./Hooks/useEditorCommit";
import { useEditorCompletion } from "./Hooks/useEditorCompletion";
import { useEditorHistory } from "./Hooks/useEditorHistory";
import { useEditorIME } from "./Hooks/useEditorIME";
import { useEditorKeybindings } from "./Hooks/useEditorKeybindings";
import { useEditorPointerClipboard } from "./Hooks/useEditorPointerClipboard";
import { useEditorRenderData } from "./Hooks/useEditorRenderData";
import { useEditorSearchReplace } from "./Hooks/useEditorSearchReplace";
import { type SelectionRange, useEditorSelectionOps } from "./Hooks/useEditorSelectionOps";
import { useExternalSync } from "./Hooks/useExternalSync";
import { useSyntaxHighlighting } from "./Hooks/useSyntaxHighlighting";
import type { IEditorEngine } from "./IEditorEngine";
import { CanvasMinimap } from "./Minimap/CanvasMinimap";
import { MultiCursorCaretLayer } from "./MultiCursor/MultiCursorCaretLayer";
import { useMultiCursorOps } from "./MultiCursor/useMultiCursorOps";
import { useSelectionOccurrence } from "./MultiCursor/useSelectionOccurrence";
import { useEditorViewport } from "./Performance/useEditorViewport";
import { DEFAULT_EDITOR_LAYOUT, measureEditorText } from "./Utils/EditorLayoutMetrics";
import { type DiagnosticItem, normalizeEditorText } from "./Utils/EditorMath";

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

  // 平滑滚动开关：设置变更即时生效（EditorSettingsSection 会广播 settings:editor-changed）
  const [smoothScrollingEnabled, setSmoothScrollingEnabled] = useState(true);
  useEffect(() => {
    let mounted = true;
    const readSetting = () => {
      UserConfigStore.get()
        .then((cfg) => {
          if (mounted) setSmoothScrollingEnabled(cfg.editorSmoothScrolling ?? true);
        })
        .catch(() => undefined);
    };
    readSetting();
    const unsub = EventBus.on("settings:editor-changed", readSetting);
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

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

  // 11. 文档更新与同步（提交路径抽至 useEditorCommit）
  // triggerAutocompleteRef 打破循环：补全 hook 依赖 commitEdit，而 commit 路径（插入/多光标）
  // 又要触发补全——与 multiCursorInsertRef 同款 ref 延迟绑定模式。
  const triggerAutocompleteRef = useRef<
    (lines: string[], lineIndex: number, charIndex: number, manual?: boolean) => void
  >(() => {});
  const {
    commitEdit,
    replaceDocumentLines,
    handleUndo,
    handleRedo,
    insertTextAtCursor,
    handleMultiCursorBackspace,
    handleMultiCursorDelete,
    handleMultiCursorEnter,
  } = useEditorCommit({
    documentLines,
    cursor,
    selection,
    extras,
    path,
    onChange,
    onSyncError,
    setDocumentLines,
    setTotalLines,
    setCursor,
    setSelection,
    updateMaxLineLength,
    pushHistory,
    pushComposite,
    undo,
    redo,
    replaceExtras,
    triggerAutocompleteRef,
    insertTextAtCursorRef,
  });
  insertTextAtCursorRef.current = insertTextAtCursor;

  // 12. Hover 与自动补全（抽至 useEditorCompletion）
  const {
    isDraggingPointerRef,
    isContextMenuOpen,
    setHoverContextMenuOpen,
    hoverTooltip,
    setVisibleHover,
    requestLanguageHover,
    handleLineMouseLeave,
    handleHoverEnter,
    handleHoverLeave,
    dismissHover,
    singleCharWidth,
    caretPos,
    completions,
    completionIndex,
    completionPos,
    setCompletionIndex,
    setCompletions,
    closeAutocomplete,
    triggerAutocomplete,
    handleAutocompleteSelect,
  } = useEditorCompletion({
    path,
    language,
    layout,
    languagePreferences,
    containerRef,
    scrollTop,
    documentLines,
    cursor,
    replaceDocumentLines,
    triggerAutocompleteRef,
  });

  // 光标可见性保障：光标移动或编辑后确保主光标行完整位于视口内（纵向行级、横向按实际前缀宽度）。
  // 小幅位移（打字/逐行移动）瞬时贴合；大幅跳转（翻页/Ctrl+End/搜索跳转等）用 120ms 缓动，
  // 与 VSCode 的滚动体感一致。
  const smoothScrollRafRef = useRef(0);
  const ensureCursorVisible = useCallback(
    (pos: { line: number; char: number }) => {
      const container = containerRef.current;
      if (!container) return;
      const lineTop = layout.contentInsetTop + pos.line * layout.lineHeight;
      let targetTop: number | null = null;
      if (lineTop < container.scrollTop) {
        targetTop = Math.max(0, lineTop);
      } else if (lineTop + layout.lineHeight > container.scrollTop + container.clientHeight) {
        targetTop = lineTop + layout.lineHeight - container.clientHeight;
      }
      if (targetTop !== null) {
        const jump = Math.abs(targetTop - container.scrollTop);
        if (jump > layout.lineHeight * 4 && smoothScrollingEnabled) {
          const startTop = container.scrollTop;
          const startTime = performance.now();
          cancelAnimationFrame(smoothScrollRafRef.current);
          const step = (now: number) => {
            const progress = Math.min(1, (now - startTime) / 120);
            const eased = 1 - (1 - progress) ** 3;
            container.scrollTop = startTop + (targetTop - startTop) * eased;
            if (progress < 1) smoothScrollRafRef.current = requestAnimationFrame(step);
          };
          smoothScrollRafRef.current = requestAnimationFrame(step);
        } else {
          container.scrollTop = targetTop;
        }
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
    [documentLines, layout, smoothScrollingEnabled],
  );

  // 卸载时终止未完成的平滑滚动动画
  useEffect(() => () => cancelAnimationFrame(smoothScrollRafRef.current), []);

  // 任何光标变化后自动保障可见（编辑/导航/撤销/替换等所有路径统一覆盖）
  useEffect(() => {
    ensureCursorVisible(cursor);
  }, [cursor, ensureCursorVisible]);

  // 13. 搜索与替换（抽至 useEditorSearchReplace）
  const {
    isSearchOpen,
    searchQuery,
    searchOptions,
    setSearchOptions,
    searchMatches,
    currentMatchIndex,
    setIsSearchOpen,
    setSearchQuery,
    handleSearchNext,
    handleSearchPrev,
    handleSearchClose,
    replaceValue,
    setReplaceValue,
    searchSeed,
    invalidSearchQuery,
    handleReplaceCurrent,
    handleReplaceAll,
  } = useEditorSearchReplace({
    documentLines,
    cursor,
    selection,
    commitEdit,
    setCursor,
    setSelection,
    scrollToLine,
  });

  // 14. 多光标批量编辑已抽至 useEditorCommit（commitMultiCursorEdits / collectMultiCursorRanges / handleMultiCursor*）

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

  // 15. 指针交互、剪贴板与上下文菜单（抽至 useEditorPointerClipboard）
  const {
    getSelectionText,
    handleCut,
    handleCopy,
    executeEditorAction,
    textIndexAtPoint,
    isDraggingRef,
    handleLineMouseDown,
    handleContextMenuOpenChange,
  } = useEditorPointerClipboard({
    documentLines,
    cursor,
    selection,
    totalLines,
    layout,
    containerRef,
    textareaRef,
    lineElementsRef,
    isDraggingPointerRef,
    setHoverContextMenuOpen,
    setCompletions,
    dismissHover,
    executeSelectionDelete,
    findWordBoundaries,
    setSelection,
    setCursor,
    handleUndo,
    handleRedo,
  });

  // 16. 外部内容同步 / revealLine / 布局测量（抽至 useExternalSync）
  useExternalSync({
    value,
    externalContent,
    revealLine,
    totalLines,
    path,
    onRevealHandled,
    setDocumentLines,
    setTotalLines,
    updateMaxLineLength,
    syncExternal,
    setCursor,
    setSelection,
    scrollToLine,
    containerRef,
    setLayout,
  });

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

  // 18-20. Minimap 装饰 / 视口行渲染 / 行号 gutter（抽至 useEditorRenderData）
  const { minimapDecorations, visibleLinesDOM, lineNumbersDOM } = useEditorRenderData({
    documentLines,
    cursor,
    selection,
    visibleStartIndex,
    visibleEndIndex,
    layout,
    linesTokens,
    largeLineTokens,
    isLargeFileMode,
    diagnostics,
    searchQuery,
    searchMatches,
    currentMatchIndex,
    foldedStartLines,
    foldableRanges,
    occurrences,
    isComposing,
    compositionText,
    path,
    textareaRef,
    isDraggingRef,
    setVisibleHover,
    requestLanguageHover,
    handleLineMouseLeave,
    handleLineMouseDown,
    textIndexAtPoint,
    registerLineElement,
    toggleFold,
    toggleBreakpoint,
    gitGutterDiff,
    addCursor,
    extraCursors,
    clearExtraCursors,
  });

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
          initialQuery={searchSeed}
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
