import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type FliunoCoreResult,
  type FliunoScope,
  FliunoSearchSession,
  parseFliunoQuery,
  queryForScope,
} from "../../Core/Fliuno/FliunoCore";
import {
  FLIUNO_RECENT_COMMANDS_KEY,
  FLIUNO_RECENT_FILES_KEY,
  readHistory,
  writeHistory,
} from "../../Core/Fliuno/history";
import { flattenFliunoPresentation, SECTION_ORDER } from "../../Core/Fliuno/presentation";
import { NavigationHistory } from "../../Core/NavigationHistory";
import { WorkspaceService } from "../../Core/WorkspaceService";
import { CommandRegistry } from "../../Extension/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";
import { type I18nKey, useLocale } from "../../Foundation/I18n";
import {
  type WorkspaceFileEntry,
  WorkspaceSearchIPC,
} from "../../Foundation/IPC/WorkspaceSearchCommands";
import { GetLanguageFromPath } from "../../Shared/Utils/LanguageUtils";
import { useEditorStore } from "../../State/useEditorStore";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { EmptyState } from "../../UI/Components/EmptyState";
import { FilterChips } from "../../UI/Components/FilterChips";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";

function HighlightedText({
  text,
  ranges,
  className = "",
}: {
  text: string;
  ranges: Array<[number, number]>;
  className?: string;
}) {
  if (!ranges.length) return <span className={className}>{text}</span>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={`${start}-${end}`}
        className="rounded-[2px] bg-[var(--color-accent)]/25 text-[var(--color-text-highlight)]"
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <span className={className}>{parts}</span>;
}

const SCOPE_OPTIONS: Array<{ id: FliunoScope; labelKey: I18nKey }> = [
  { id: "all", labelKey: "fliuno.scopeAll" },
  { id: "commands", labelKey: "common.command" },
  { id: "files", labelKey: "common.file" },
  { id: "settings", labelKey: "common.setting" },
  { id: "symbols", labelKey: "common.symbol" },
  { id: "content", labelKey: "common.content" },
  { id: "extensions", labelKey: "extensions.sidebarTitle" },
];

export function FliunoWorkspacePage({
  variant = "page",
}: {
  /** page: 编辑区整页；sidebar: 左侧侧边栏紧凑卡片 */
  variant?: "page" | "sidebar";
}) {
  const { t } = useLocale();
  const compact = variant === "sidebar";
  const sessionRef = useRef<FliunoSearchSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new FliunoSearchSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<FliunoScope>("all");
  const [results, setResults] = useState<FliunoCoreResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentCommands, setRecentCommands] = useState(() =>
    readHistory(FLIUNO_RECENT_COMMANDS_KEY),
  );
  const [recentFiles, setRecentFiles] = useState(() => readHistory(FLIUNO_RECENT_FILES_KEY));
  const [workspaceRoot, setWorkspaceRoot] = useState(
    () => WorkspaceService.getCurrent().primaryRoot,
  );
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [contentCaseSensitive, setContentCaseSensitive] = useState(false);
  const [contentRegex, setContentRegex] = useState(false);
  const indexedRootRef = useRef<string | null>(null);

  const loadFiles = useCallback(async (root: string) => {
    try {
      setFiles(await WorkspaceSearchIPC.listFiles(root));
    } catch {
      setFiles([]);
    }
  }, []);

  useEffect(
    () =>
      WorkspaceService.subscribe((workspace) => {
        indexedRootRef.current = null;
        setWorkspaceRoot(workspace.primaryRoot);
      }),
    [],
  );

  useEffect(() => {
    if (workspaceRoot && indexedRootRef.current !== workspaceRoot) {
      indexedRootRef.current = workspaceRoot;
      void loadFiles(workspaceRoot);
    }
  }, [loadFiles, workspaceRoot]);

  useEffect(
    () =>
      EventBus.on("fs:changed", () => {
        if (workspaceRoot) void loadFiles(workspaceRoot);
      }),
    [loadFiles, workspaceRoot],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(
    (nextQuery: string, nextScope: FliunoScope) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const session = sessionRef.current;
        if (!session) return;
        session.cancel();
        setSelectedIndex(-1);
        const workbench = useWorkbenchStore.getState();
        const activeTab = workbench.tabs.find((tab) => tab.id === workbench.activeTabId);
        const activeFilePath = activeTab?.type === "file" ? activeTab.path : undefined;
        const openFileTabs = workbench.tabs
          .filter((tab) => tab.type === "file" && tab.path)
          .map((tab) => ({
            path: tab.path as string,
            language: GetLanguageFromPath(tab.path as string),
          }));
        void session
          .search({
            query: nextQuery,
            scope: nextScope,
            commands: CommandRegistry.getCommands(),
            files,
            recentCommands,
            recentFiles,
            openFiles: openFileTabs.map((tab) => tab.path),
            openFileTabs,
            activeFilePath,
            activeLanguage: useEditorStore.getState().editorStatus.language,
            workspaceRoot: workspaceRoot || undefined,
            contentCaseSensitive,
            contentRegex,
            excludedCommandId: "workbench.action.openFliunoWorkspace",
          })
          .then(setResults);
      }, 120);
    },
    [contentCaseSensitive, contentRegex, files, recentCommands, recentFiles, workspaceRoot],
  );

  useEffect(() => {
    runSearch(query, scope);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      sessionRef.current?.cancel();
    };
  }, [query, runSearch, scope]);

  /**
   * 展示顺序 = 键盘导航顺序 = Enter 执行顺序。
   * displayResults 按可视分组顺序拍平：命令/文件/设置/符号，内容按文件分组。
   */
  const presentation = useMemo(() => {
    return flattenFliunoPresentation(results);
  }, [results]);

  const grouped = useMemo(
    () =>
      SECTION_ORDER.map((kind) => ({
        kind,
        items: presentation.display.filter((result) => result.kind === kind),
      })).filter((group) => group.items.length > 0),
    [presentation.display],
  );

  const pushRecentCommand = (id: string) => {
    setRecentCommands((current) => {
      const next = [id, ...current.filter((item) => item !== id)].slice(0, 30);
      writeHistory(FLIUNO_RECENT_COMMANDS_KEY, next);
      return next;
    });
  };

  const pushRecentFile = (path: string) => {
    setRecentFiles((current) => {
      const next = [path, ...current.filter((item) => item !== path)].slice(0, 30);
      writeHistory(FLIUNO_RECENT_FILES_KEY, next);
      return next;
    });
  };

  const execute = (result: FliunoCoreResult) => {
    const workbench = useWorkbenchStore.getState();
    switch (result.action) {
      case "executeCommand":
        if (result.commandId) {
          void CommandRegistry.execute(result.commandId);
          pushRecentCommand(result.commandId);
        }
        break;
      case "openFile":
        if (result.targetPath) {
          workbench.openFile(result.targetPath);
          pushRecentFile(result.targetPath);
        }
        break;
      case "openSettings":
        workbench.openSettings(result.settingCategory, result.settingId);
        break;
      case "revealSymbol":
      case "revealContent":
        if (result.targetPath) {
          const editor = useEditorStore.getState().editorStatus;
          if (editor.path) {
            NavigationHistory.record({
              path: editor.path,
              line: editor.line,
              character: editor.column,
            });
          }
          workbench.openFile(result.targetPath);
          const targetLine = result.targetLine ?? 1;
          workbench.requestReveal(result.targetPath, targetLine);
          NavigationHistory.record({ path: result.targetPath, line: targetLine });
        }
        break;
      case "customExtension":
        if (result.onSelect) {
          void result.onSelect();
        }
        break;
    }
  };

  const moveSelection = (offset: number) => {
    const count = presentation.display.length;
    if (!count) return;
    setSelectedIndex((index) => {
      if (index < 0) return offset > 0 ? 0 : -1;
      return Math.min(Math.max(index + offset, 0), count - 1);
    });
  };

  const jumpSelection = (target: "start" | "end" | "pageUp" | "pageDown") => {
    const count = presentation.display.length;
    if (!count) return;
    setSelectedIndex((index) => {
      const base = index < 0 ? 0 : index;
      if (target === "start") return 0;
      if (target === "end") return count - 1;
      const page = 12;
      if (target === "pageUp") return Math.max(0, base - page);
      return Math.min(count - 1, base + page);
    });
  };

  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const element = container.querySelector<HTMLElement>(
      `[data-fliuno-workspace-index="${selectedIndex}"]`,
    );
    element?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const selectScope = (nextScope: FliunoScope) => {
    setScope(nextScope);
    setQuery((current) => queryForScope(current, nextScope));
    setSelectedIndex(-1);
  };

  const parsed = parseFliunoQuery(query, scope);
  const selectedResult = presentation.display[selectedIndex];

  return (
    <div
      className={
        compact
          ? "flex h-full min-h-0 flex-col gap-2.5 bg-transparent px-3 pb-2.5 pt-3"
          : "flex h-full min-h-0 flex-col gap-3 bg-transparent px-6 pb-3 pt-4"
      }
    >
      <div
        className={`flex shrink-0 items-center border border-[var(--border-overlay)] bg-[var(--material-panel)] backdrop-blur-[var(--glass-blur-overlay)] transition-[border-color,box-shadow] focus-within:border-[var(--color-text-muted)]/25 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-text-muted)_14%,transparent)] ${
          compact ? "h-10 gap-2 rounded-xl px-3" : "h-12 gap-3 rounded-2xl px-4"
        }`}
      >
        <span
          className={`flex shrink-0 items-center justify-center bg-[var(--color-accent)]/10 text-[var(--color-accent)] ${
            compact ? "h-7 w-7 rounded-lg" : "h-8 w-8 rounded-xl"
          }`}
        >
          <Icons.Search size={16} stroke={1.8} />
        </span>
        <input
          ref={inputRef}
          data-fliuno-input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveSelection(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveSelection(-1);
            } else if (event.key === "PageDown") {
              event.preventDefault();
              jumpSelection("pageDown");
            } else if (event.key === "PageUp") {
              event.preventDefault();
              jumpSelection("pageUp");
            } else if (event.key === "Home") {
              event.preventDefault();
              jumpSelection("start");
            } else if (event.key === "End") {
              event.preventDefault();
              jumpSelection("end");
            } else if (event.key === "Tab") {
              event.preventDefault();
              const index = SCOPE_OPTIONS.findIndex((option) => option.id === parsed.scope);
              const nextScope =
                SCOPE_OPTIONS[
                  (index + (event.shiftKey ? -1 : 1) + SCOPE_OPTIONS.length) % SCOPE_OPTIONS.length
                ].id;
              selectScope(nextScope);
            } else if (event.key === "Enter" && selectedResult) {
              event.preventDefault();
              execute(selectedResult);
            }
          }}
          placeholder={t("fliuno.workspacePlaceholder")}
          className={`h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 font-medium text-[var(--color-text-highlight)] outline-none ring-0 placeholder:font-normal placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:outline-none focus-visible:ring-0 ${
            compact ? "text-[13px]" : "text-[14px]"
          }`}
        />
        {query && (
          <button
            type="button"
            aria-label={t("common.clear")}
            onClick={() => {
              setQuery("");
              setSelectedIndex(-1);
              inputRef.current?.focus();
            }}
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
          >
            <Icons.Close size={14} />
          </button>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 px-1">
        <FilterChips
          className="flex-wrap"
          size={compact ? "sm" : "md"}
          ariaLabel={t("fliuno.workspacePlaceholder")}
          value={parsed.scope}
          onChange={selectScope}
          items={SCOPE_OPTIONS.map((option) => ({
            id: option.id,
            label: t(option.labelKey),
          }))}
        />
        {parsed.scope === "content" && (
          <>
            <span className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />
            <Tooltip content={t("fliuno.caseSensitive")} placement="bottom">
              <button
                type="button"
                aria-label={t("fliuno.caseSensitive")}
                onClick={() => setContentCaseSensitive((value) => !value)}
                className={`rounded-lg p-1.5 transition-colors ${
                  contentCaseSensitive
                    ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)]"
                }`}
              >
                <Icons.Typography size={13} stroke={contentCaseSensitive ? 2.5 : 2} />
              </button>
            </Tooltip>
            <Tooltip content={t("fliuno.regex")} placement="bottom">
              <button
                type="button"
                aria-label={t("fliuno.regex")}
                onClick={() => setContentRegex((value) => !value)}
                className={`rounded-lg p-1.5 transition-colors ${
                  contentRegex
                    ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)]"
                }`}
              >
                <Icons.Asterisk size={13} stroke={contentRegex ? 2.5 : 2} />
              </button>
            </Tooltip>
          </>
        )}
        <span className="ml-auto pr-1 text-[10px] text-[var(--color-text-muted)]">
          {t("fliuno.resultsCount").replace("{count}", String(presentation.display.length))}
        </span>
      </div>

      <div ref={resultsRef} className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 aurona-scroll">
        {!workspaceRoot && (query || scope !== "commands") ? (
          <EmptyState
            className={compact ? "min-h-[160px]" : "min-h-[240px]"}
            icon={<Icons.Search size={24} stroke={1.5} />}
            title={t("fliuno.noWorkspace")}
          />
        ) : grouped.length ? (
          <div className={compact ? "flex flex-col gap-3" : "flex flex-col gap-6"}>
            {grouped.map((group) => {
              if (group.kind === "content") {
                return (
                  <section key={group.kind}>
                    <div className="flex flex-col gap-2.5">
                      {presentation.contentGroups.map((fileGroup) => (
                        <div
                          key={fileGroup.path}
                          className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--material-surface)]"
                        >
                          <div className="truncate border-b border-[var(--border-subtle)] px-3 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                            {fileGroup.path}
                          </div>
                          {fileGroup.items.map((result) => {
                            const displayIndex = presentation.indexById.get(result.id) ?? 0;
                            return (
                              <ContentRow
                                key={result.id}
                                result={result}
                                displayIndex={displayIndex}
                                selected={displayIndex === selectedIndex}
                                onSelect={() => setSelectedIndex(displayIndex)}
                                onExecute={execute}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </section>
                );
              }
              return (
                <section key={group.kind}>
                  <div
                    className={
                      compact
                        ? "flex flex-col gap-1"
                        : "grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
                    }
                  >
                    {group.items.map((result) => {
                      const displayIndex = presentation.indexById.get(result.id) ?? 0;
                      return (
                        <ResultCard
                          key={result.id}
                          result={result}
                          displayIndex={displayIndex}
                          selected={displayIndex === selectedIndex}
                          compact={compact}
                          onSelect={() => setSelectedIndex(displayIndex)}
                          onExecute={execute}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <EmptyState
            className={compact ? "min-h-[160px]" : "min-h-[240px]"}
            icon={<Icons.Search size={24} stroke={1.5} />}
            title={query ? t("common.noResults") : t("fliuno.emptyHint")}
          />
        )}
      </div>

      {!compact && (
        <footer className="flex shrink-0 items-center gap-4 px-1 text-[9px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5">
              ↑↓
            </kbd>
            {t("common.search")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5">
              Enter
            </kbd>
            {t("common.open")}
          </span>
          <span className="ml-auto flex items-center gap-3">
            <span>
              {"#"} {t("common.symbol")}
            </span>
            <span>
              {":"} {t("common.content")}
            </span>
          </span>
        </footer>
      )}
    </div>
  );
}

function ResultCard({
  result,
  displayIndex,
  selected,
  compact,
  onSelect,
  onExecute,
}: {
  result: FliunoCoreResult;
  displayIndex: number;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
  onExecute: (result: FliunoCoreResult) => void;
}) {
  if (compact) {
    return (
      <button
        type="button"
        data-result-id={result.id}
        data-fliuno-workspace-index={displayIndex}
        onClick={() => onExecute(result)}
        onMouseMove={onSelect}
        className={`flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors ${
          selected
            ? "border-transparent bg-[var(--material-interactive-active)]"
            : "border-transparent hover:bg-[var(--material-interactive-hover)]"
        }`}
      >
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-lg ${
            result.kind === "command"
              ? "bg-[var(--material-panel)] text-[var(--color-text-muted)]"
              : "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
          }`}
        >
          <ResultIcon kind={result.kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium">
            <HighlightedText text={result.title} ranges={result.titleRanges} />
          </span>
          <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
            <HighlightedText text={result.description} ranges={result.descriptionRanges} />
          </span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      data-result-id={result.id}
      data-fliuno-workspace-index={displayIndex}
      onClick={() => onExecute(result)}
      onMouseMove={onSelect}
      className={`flex min-h-[72px] flex-col justify-between gap-2 rounded-xl border p-3 text-left transition-all ${
        selected
          ? "border-transparent bg-[var(--material-interactive-active)]"
          : "border-[var(--border-subtle)] bg-[var(--material-surface)] hover:border-[var(--border-overlay)] hover:bg-[var(--material-interactive-hover)]"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-lg ${
            result.kind === "command"
              ? "bg-[var(--material-panel)] text-[var(--color-text-muted)]"
              : "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
          }`}
        >
          <ResultIcon kind={result.kind} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
          <HighlightedText text={result.title} ranges={result.titleRanges} />
        </span>
      </span>
      <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
        <HighlightedText text={result.description} ranges={result.descriptionRanges} />
      </span>
    </button>
  );
}

function ContentRow({
  result,
  displayIndex,
  selected,
  onSelect,
  onExecute,
}: {
  result: FliunoCoreResult;
  displayIndex: number;
  selected: boolean;
  onSelect: () => void;
  onExecute: (result: FliunoCoreResult) => void;
}) {
  return (
    <button
      type="button"
      data-result-id={result.id}
      data-fliuno-workspace-index={displayIndex}
      onClick={() => onExecute(result)}
      onMouseMove={onSelect}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
        selected
          ? "bg-[var(--material-interactive-active)]"
          : "hover:bg-[var(--material-interactive-hover)]"
      }`}
    >
      <span className="w-10 shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
        {result.targetLine}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px]">
        <HighlightedText text={result.description} ranges={result.descriptionRanges} />
      </span>
    </button>
  );
}

function ResultIcon({ kind }: { kind: FliunoCoreResult["kind"] }) {
  switch (kind) {
    case "command":
      return <Icons.Command size={14} stroke={1.8} />;
    case "file":
      return <Icons.FileCode size={14} stroke={1.8} />;
    case "setting":
      return <Icons.Settings size={14} stroke={1.8} />;
    case "symbol":
      return <Icons.Sparkles size={14} stroke={1.8} />;
    case "content":
      return <Icons.Search size={14} stroke={1.8} />;
  }
}
