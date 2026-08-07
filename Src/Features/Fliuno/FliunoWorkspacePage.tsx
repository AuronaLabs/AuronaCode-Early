import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type FliunoCoreResult,
  type FliunoCoreResultKind,
  type FliunoScope,
  FliunoSearchSession,
  parseFliunoQuery,
} from "../../Core/Fliuno/FliunoCore";
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
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";

const RECENT_COMMANDS_KEY = "aurona.fliuno.recent.v1";
const RECENT_FILES_KEY = "aurona.fliuno.files.recent.v1";

const readHistory = (key: string): string[] => {
  try {
    const value = localStorage.getItem(key);
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const writeHistory = (key: string, value: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(value.slice(0, 30)));
  } catch {
    // 历史记录失败不影响搜索。
  }
};

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
];

export function FliunoWorkspacePage() {
  const { t } = useLocale();
  const sessionRef = useRef<FliunoSearchSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new FliunoSearchSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<FliunoScope>("all");
  const [results, setResults] = useState<FliunoCoreResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentCommands, setRecentCommands] = useState(() => readHistory(RECENT_COMMANDS_KEY));
  const [recentFiles, setRecentFiles] = useState(() => readHistory(RECENT_FILES_KEY));
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
        setSelectedIndex(0);
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

  const grouped = useMemo(() => {
    const order: FliunoCoreResultKind[] = ["command", "file", "setting", "symbol", "content"];
    return order
      .map((kind) => ({ kind, items: results.filter((result) => result.kind === kind) }))
      .filter((group) => group.items.length > 0);
  }, [results]);

  const contentByFile = useMemo(() => {
    const map = new Map<string, FliunoCoreResult[]>();
    for (const result of results) {
      if (result.kind !== "content" || !result.targetPath) continue;
      const list = map.get(result.targetPath) ?? [];
      list.push(result);
      map.set(result.targetPath, list);
    }
    return [...map.entries()].map(([path, items]) => ({ path, items }));
  }, [results]);

  const indexById = useMemo(() => {
    const map: Record<string, number> = {};
    results.forEach((result, index) => {
      map[result.id] = index;
    });
    return map;
  }, [results]);

  const pushRecentCommand = (id: string) => {
    setRecentCommands((current) => {
      const next = [id, ...current.filter((item) => item !== id)].slice(0, 30);
      writeHistory(RECENT_COMMANDS_KEY, next);
      return next;
    });
  };

  const pushRecentFile = (path: string) => {
    setRecentFiles((current) => {
      const next = [path, ...current.filter((item) => item !== path)].slice(0, 30);
      writeHistory(RECENT_FILES_KEY, next);
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
        workbench.openTab({ id: "settings", type: "settings", title: "设置" });
        break;
      case "revealSymbol":
      case "revealContent":
        if (result.targetPath) {
          workbench.openFile(result.targetPath);
          if (result.targetLine) workbench.requestReveal(result.targetPath, result.targetLine);
        }
        break;
    }
  };

  const moveSelection = (offset: number) => {
    if (!results.length) return;
    setSelectedIndex((index) => Math.min(Math.max(index + offset, 0), results.length - 1));
  };

  const parsed = parseFliunoQuery(query, scope);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-transparent px-6 pb-3 pt-4">
      <div className="flex h-12 shrink-0 items-center gap-3 rounded-2xl border border-[var(--border-overlay)] bg-[var(--material-panel)] px-4 backdrop-blur-[var(--glass-blur-floating)]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
          <Icons.Search size={16} stroke={1.8} />
        </span>
        <input
          ref={inputRef}
          data-fliuno-input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveSelection(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveSelection(-1);
            } else if (event.key === "Enter" && results[selectedIndex]) {
              event.preventDefault();
              execute(results[selectedIndex]);
            }
          }}
          placeholder={t("fliuno.workspacePlaceholder")}
          className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[14px] font-medium text-[var(--color-text-highlight)] outline-none ring-0 placeholder:font-normal placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:outline-none focus-visible:ring-0"
        />
        {query && (
          <button
            type="button"
            aria-label={t("common.clear")}
            onClick={() => {
              setQuery("");
              setSelectedIndex(0);
              inputRef.current?.focus();
            }}
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
          >
            <Icons.Close size={14} />
          </button>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 px-1">
        {SCOPE_OPTIONS.map((option) => {
          const active = parsed.scope === option.id;
          return (
            <button
              type="button"
              key={option.id}
              onClick={() => {
                setScope(option.id);
                setSelectedIndex(0);
              }}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
                active
                  ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {t(option.labelKey)}
            </button>
          );
        })}
        {parsed.scope === "content" && (
          <>
            <span className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />
            <Tooltip content="区分大小写" placement="bottom">
              <button
                type="button"
                aria-label="区分大小写"
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
            <Tooltip content="正则表达式" placement="bottom">
              <button
                type="button"
                aria-label="正则表达式"
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
          {t("fliuno.resultsCount").replace("{count}", String(results.length))}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 aurona-scroll">
        {!workspaceRoot && (query || scope !== "commands") ? (
          <EmptyState text={t("fliuno.noWorkspace")} />
        ) : grouped.length ? (
          <div className="flex flex-col gap-6">
            {grouped.map((group) => {
              if (group.kind === "content") {
                return (
                  <section key={group.kind}>
                    <div className="flex flex-col gap-2.5">
                      {contentByFile.map((fileGroup) => (
                        <div
                          key={fileGroup.path}
                          className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--material-surface)]"
                        >
                          <div className="truncate border-b border-[var(--border-subtle)] px-3 py-2 font-mono text-[10px] text-[var(--color-text-muted)]">
                            {fileGroup.path}
                          </div>
                          {fileGroup.items.map((result) => (
                            <ContentRow
                              key={result.id}
                              result={result}
                              selected={selectedIndex === (indexById[result.id] ?? 0)}
                              onSelect={() => setSelectedIndex(indexById[result.id] ?? 0)}
                              onExecute={execute}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </section>
                );
              }
              return (
                <section key={group.kind}>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {group.items.map((result) => (
                      <ResultCard
                        key={result.id}
                        result={result}
                        selected={selectedIndex === (indexById[result.id] ?? 0)}
                        onSelect={() => setSelectedIndex(indexById[result.id] ?? 0)}
                        onExecute={execute}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <EmptyState text={query ? t("common.noResults") : t("fliuno.emptyHint")} />
        )}
      </div>

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
    </div>
  );
}

function ResultCard({
  result,
  selected,
  onSelect,
  onExecute,
}: {
  result: FliunoCoreResult;
  selected: boolean;
  onSelect: () => void;
  onExecute: (result: FliunoCoreResult) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onExecute(result)}
      onMouseMove={onSelect}
      className={`flex min-h-[72px] flex-col justify-between gap-2 rounded-xl border p-3 text-left transition-all ${
        selected
          ? "border-[color-mix(in_srgb,var(--color-accent)_38%,var(--border-subtle))] bg-[var(--material-interactive-active)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_16%,transparent)]"
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
  selected,
  onSelect,
  onExecute,
}: {
  result: FliunoCoreResult;
  selected: boolean;
  onSelect: () => void;
  onExecute: (result: FliunoCoreResult) => void;
}) {
  return (
    <button
      type="button"
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

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--material-surface)] text-[var(--color-text-muted)]">
        <Icons.Search size={22} />
      </span>
      <span className="text-[12px] text-[var(--color-text-primary)]">{text}</span>
    </div>
  );
}

function ResultIcon({ kind }: { kind: FliunoCoreResultKind }) {
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
