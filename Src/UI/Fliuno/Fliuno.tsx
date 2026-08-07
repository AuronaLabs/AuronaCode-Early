import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type FliunoCoreResult,
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
import { Icons } from "../Icons/IconManager";

const FLIUNO_RECENT_COMMANDS_KEY = "aurona.fliuno.recent.v1";
const FLIUNO_RECENT_FILES_KEY = "aurona.fliuno.files.recent.v1";
const LEGACY_RECENT_KEY = "aurona.commandPalette.recent.v1";
const FLIUNO_COMMAND_ID = "workbench.action.openFliuno";

const readHistory = (key: string, fallbackKey?: string): string[] => {
  try {
    const value = localStorage.getItem(key) ?? (fallbackKey && localStorage.getItem(fallbackKey));
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
    // 搜索历史可选，不阻塞操作。
  }
};

function HighlightedText({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  if (!ranges.length) return <>{text}</>;
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
  return <>{parts}</>;
}

const scopeOptions: Array<{
  id: FliunoScope;
  labelKey: I18nKey;
  icon: "Search" | "Command" | "Files" | "Settings" | "Sparkles" | "Search";
}> = [
  { id: "all", labelKey: "fliuno.scopeAll", icon: "Search" },
  { id: "commands", labelKey: "common.command", icon: "Command" },
  { id: "files", labelKey: "common.file", icon: "Files" },
  { id: "settings", labelKey: "common.setting", icon: "Settings" },
  { id: "symbols", labelKey: "common.symbol", icon: "Sparkles" },
  { id: "content", labelKey: "common.content", icon: "Search" },
];

export function Fliuno() {
  const { t } = useLocale();
  const sessionRef = useRef<FliunoSearchSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new FliunoSearchSession();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<FliunoScope>("all");
  const [results, setResults] = useState<FliunoCoreResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [, setInteractionMode] = useState<"keyboard" | "pointer">("keyboard");
  const [recentCommands, setRecentCommands] = useState(() =>
    readHistory(FLIUNO_RECENT_COMMANDS_KEY, LEGACY_RECENT_KEY),
  );
  const [recentFiles, setRecentFiles] = useState(() => readHistory(FLIUNO_RECENT_FILES_KEY));
  const [workspaceRoot, setWorkspaceRoot] = useState(
    () => WorkspaceService.getCurrent().primaryRoot,
  );
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [fileIndexState, setFileIndexState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [fileIndexError, setFileIndexError] = useState<string | null>(null);
  const indexedRootRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultListRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registryRevision = useSyncExternalStore(
    (listener) => CommandRegistry.subscribe(listener),
    () => CommandRegistry.getRevision(),
    () => 0,
  );

  const commands = useMemo(() => {
    void registryRevision;
    return isOpen ? CommandRegistry.getCommands() : [];
  }, [isOpen, registryRevision]);

  const parsedQuery = useMemo(() => parseFliunoQuery(query, scope), [query, scope]);

  const loadFiles = useCallback(async (root: string) => {
    setFileIndexState("loading");
    setFileIndexError(null);
    try {
      setFiles(await WorkspaceSearchIPC.listFiles(root));
      setFileIndexState("ready");
    } catch (error) {
      setFiles([]);
      setFileIndexState("error");
      setFileIndexError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(
    () =>
      WorkspaceService.subscribe((workspace) => {
        indexedRootRef.current = null;
        setFiles([]);
        setFileIndexState("idle");
        setWorkspaceRoot(workspace.primaryRoot);
      }),
    [],
  );

  useEffect(() => {
    if (isOpen && workspaceRoot && indexedRootRef.current !== workspaceRoot) {
      indexedRootRef.current = workspaceRoot;
      void loadFiles(workspaceRoot);
    }
  }, [isOpen, loadFiles, workspaceRoot]);

  useEffect(
    () =>
      EventBus.on("app:show-fliuno", () => {
        setQuery("");
        setScope("all");
        setSelectedIndex(0);
        setInteractionMode("keyboard");
        setIsOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }),
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLocaleLowerCase("en-US") === "p") {
        event.preventDefault();
        setQuery("");
        setScope("all");
        setSelectedIndex(0);
        setIsOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const close = () => {
    sessionRef.current?.cancel();
    setIsOpen(false);
    setResults([]);
    setQuery("");
  };

  const runSearch = useCallback(
    (nextQuery: string, nextScope: FliunoScope) => {
      if (!isOpen) return;
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
            excludedCommandId: FLIUNO_COMMAND_ID,
          })
          .then(setResults);
      }, 100);
    },
    [files, isOpen, recentCommands, recentFiles, workspaceRoot],
  );

  useEffect(() => {
    runSearch(query, scope);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, runSearch, scope]);

  const execute = (result: FliunoCoreResult) => {
    const workbench = useWorkbenchStore.getState();
    switch (result.action) {
      case "executeCommand":
        if (result.commandId) {
          void CommandRegistry.execute(result.commandId);
          setRecentCommands((current) => {
            const next = [
              result.commandId as string,
              ...current.filter((id) => id !== result.commandId),
            ].slice(0, 30);
            writeHistory(FLIUNO_RECENT_COMMANDS_KEY, next);
            return next;
          });
        }
        break;
      case "openFile":
        if (result.targetPath) {
          workbench.openFile(result.targetPath);
          setRecentFiles((current) => {
            const next = [
              result.targetPath as string,
              ...current.filter((path) => path !== result.targetPath),
            ].slice(0, 30);
            writeHistory(FLIUNO_RECENT_FILES_KEY, next);
            return next;
          });
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
    close();
  };

  const moveSelection = (offset: number) => {
    if (!results.length) return;
    setSelectedIndex((index) => Math.min(Math.max(index + offset, 0), results.length - 1));
  };

  const selectScope = (nextScope: FliunoScope) => {
    setScope(nextScope);
    setSelectedIndex(0);
    setInteractionMode("keyboard");
  };

  const commandByResult = useMemo(() => {
    const map = new Map<string, (typeof commands)[number]>();
    for (const command of commands) map.set(command.id, command);
    return map;
  }, [commands]);

  if (!isOpen) return null;

  const hasQuery = query.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center px-5 pt-[9vh]">
      <button
        type="button"
        aria-label="关闭 Fliuno"
        className="absolute inset-0 bg-black/20 backdrop-blur-[5px]"
        onClick={close}
      />
      <section
        data-testid="fliuno-surface"
        aria-label="Fliuno 全局搜索"
        className={`relative grid w-full max-w-[720px] overflow-hidden border border-[var(--border-overlay)] bg-[var(--material-panel)] backdrop-blur-[var(--glass-blur-floating)] transition-[border-radius] duration-200 ${
          hasQuery ? "rounded-[20px]" : "rounded-[18px]"
        }`}
      >
        <div className="flex h-14 items-center gap-3 px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
            <Icons.Search size={17} stroke={1.8} />
          </span>
          <input
            ref={inputRef}
            data-fliuno-input
            data-aurona-input="embedded"
            role="combobox"
            aria-expanded={hasQuery}
            aria-controls="fliuno-results"
            aria-activedescendant={results[selectedIndex]?.id}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
              setInteractionMode("keyboard");
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(-1);
              } else if (event.key === "Tab") {
                event.preventDefault();
                const index = scopeOptions.findIndex((item) => item.id === parsedQuery.scope);
                selectScope(
                  scopeOptions[
                    (index + (event.shiftKey ? -1 : 1) + scopeOptions.length) % scopeOptions.length
                  ].id,
                );
              } else if (event.key === "Enter" && results[selectedIndex]) {
                event.preventDefault();
                execute(results[selectedIndex]);
              }
            }}
            placeholder={t("fliuno.quickPlaceholder")}
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

        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
            hasQuery
              ? "grid-rows-[1fr] opacity-100"
              : "pointer-events-none grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex items-center gap-1 border-t border-[var(--border-subtle)] px-5 py-3">
              {scopeOptions.map((option) => {
                const active = parsedQuery.scope === option.id;
                const ScopeIcon = Icons[option.icon];
                return (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => selectScope(option.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
                      active
                        ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                        : "text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    <ScopeIcon size={12} stroke={1.8} />
                    {t(option.labelKey)}
                  </button>
                );
              })}
              <span className="ml-auto text-[9px] text-[var(--color-text-muted)]">
                {fileIndexState === "loading" && parsedQuery.scope !== "commands"
                  ? t("fliuno.indexing")
                  : t("fliuno.resultsCount").replace("{count}", String(results.length))}
              </span>
            </div>

            <div
              ref={resultListRef}
              id="fliuno-results"
              role="listbox"
              className="max-h-[56vh] min-h-[190px] overflow-y-auto border-t border-[var(--border-subtle)] px-2 py-2 aurona-scroll"
              onMouseLeave={() => setInteractionMode("keyboard")}
            >
              {results.length ? (
                <div className="flex flex-col gap-0.5">
                  {results.map((result, index) => {
                    const command =
                      result.kind === "command"
                        ? commandByResult.get(result.commandId ?? "")
                        : undefined;
                    const enabled =
                      result.kind === "file" ||
                      result.kind !== "command" ||
                      (command ? CommandRegistry.canExecute(command) : false);
                    const selected = index === selectedIndex;
                    const keybinding = command?.keybindings?.[0]
                      ? [
                          command.keybindings[0].primary ? "Ctrl/Cmd" : "",
                          command.keybindings[0].shift ? "Shift" : "",
                          command.keybindings[0].alt ? "Alt" : "",
                          command.keybindings[0].key.toUpperCase(),
                        ]
                          .filter(Boolean)
                          .join("+")
                      : "";
                    return (
                      <button
                        type="button"
                        role="option"
                        id={result.id}
                        data-fliuno-index={index}
                        aria-selected={selected}
                        key={result.id}
                        disabled={!enabled}
                        onMouseMove={() => {
                          setInteractionMode("pointer");
                          setSelectedIndex(index);
                        }}
                        onClick={() => execute(result)}
                        className={`group flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                          selected
                            ? "bg-[var(--material-interactive-active)] text-[var(--color-text-highlight)]"
                            : "text-[var(--color-text-primary)] hover:bg-[var(--material-interactive-hover)]"
                        } ${enabled ? "" : "cursor-not-allowed opacity-45"}`}
                      >
                        <span
                          className={`grid size-8 shrink-0 place-items-center rounded-xl ${
                            result.kind === "command"
                              ? "bg-[var(--material-panel)] text-[var(--color-text-muted)]"
                              : "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                          }`}
                        >
                          <ResultIcon kind={result.kind} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium">
                              <HighlightedText text={result.title} ranges={result.titleRanges} />
                            </span>
                            {result.recent && !query && (
                              <span className="shrink-0 text-[8px] text-[var(--color-text-muted)]">
                                {t("common.recent")}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-[var(--color-text-muted)]">
                            <HighlightedText
                              text={result.description}
                              ranges={result.descriptionRanges}
                            />
                          </span>
                        </span>
                        {!enabled && command && (
                          <span className="max-w-44 truncate text-[9px] text-[var(--color-text-muted)]">
                            {CommandRegistry.getDisabledReason(command) ?? "当前不可用"}
                          </span>
                        )}
                        {keybinding && (
                          <kbd className="rounded-md border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-text-muted)]">
                            {keybinding}
                          </kbd>
                        )}
                        <Icons.ArrowRight
                          size={13}
                          className={`shrink-0 text-[var(--color-text-muted)] transition-opacity ${
                            selected ? "opacity-80" : "opacity-0"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-[210px] flex-col items-center justify-center gap-3 px-6 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--material-surface)] text-[var(--color-text-muted)]">
                    <Icons.Search size={20} />
                  </span>
                  <div>
                    <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
                      {!workspaceRoot && parsedQuery.scope !== "commands"
                        ? t("fliuno.noWorkspace")
                        : fileIndexState === "error"
                          ? (fileIndexError ?? t("common.noResults"))
                          : parsedQuery.query
                            ? t("common.noResults")
                            : t("fliuno.emptyHint")}
                    </div>
                    <div className="mt-1 max-w-[420px] text-[10px] text-[var(--color-text-muted)]">
                      {parsedQuery.query ? t("common.tryShorter") : ""}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <footer className="flex items-center gap-4 border-t border-[var(--border-subtle)] px-5 py-2.5 text-[9px] text-[var(--color-text-muted)]">
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
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5">
                  Esc
                </kbd>
                {t("common.cancel")}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <span>
                  {">"} {t("common.command")}
                </span>
                <span>
                  {"@"} {t("common.file")}
                </span>
                <span>
                  {"#"} {t("common.symbol")}
                </span>
                <span>
                  {":"} {t("common.content")}
                </span>
              </span>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}

function ResultIcon({ kind }: { kind: FliunoCoreResult["kind"] }) {
  switch (kind) {
    case "command":
      return <Icons.Command size={15} stroke={1.7} />;
    case "file":
      return <Icons.FileCode size={15} stroke={1.7} />;
    case "setting":
      return <Icons.Settings size={15} stroke={1.7} />;
    case "symbol":
      return <Icons.Sparkles size={15} stroke={1.7} />;
    case "content":
      return <Icons.Search size={15} stroke={1.7} />;
  }
}
