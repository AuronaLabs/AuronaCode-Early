import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { WorkspaceService } from "../../Core/WorkspaceService";
import { CommandRegistry } from "../../Extension/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";
import {
  type WorkspaceFileEntry,
  WorkspaceSearchIPC,
} from "../../Foundation/IPC/WorkspaceSearchCommands";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Icons } from "../Icons/IconManager";
import {
  buildFliunoResults,
  type FliunoResult,
  type FliunoScope,
  parseFliunoQuery,
} from "./FliunoSearch";

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

const writeHistory = (key: string, values: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Search history is optional and never blocks a Fliuno action.
  }
};

const formatKeybinding = (result: FliunoResult) => {
  if (result.kind !== "command") return "";
  const binding = result.command.keybindings?.[0];
  if (!binding) return "";
  return [
    binding.primary ? "Ctrl/Cmd" : "",
    binding.shift ? "Shift" : "",
    binding.alt ? "Alt" : "",
    binding.key.toUpperCase(),
  ]
    .filter(Boolean)
    .join("+");
};

const scopeOptions: {
  id: FliunoScope;
  label: string;
  prefix: string;
  icon: "Search" | "Command" | "Files";
}[] = [
  { id: "all", label: "全部", prefix: "", icon: "Search" },
  { id: "commands", label: "命令", prefix: ">", icon: "Command" },
  { id: "files", label: "文件", prefix: "@", icon: "Files" },
];

export function Fliuno() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<FliunoScope>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [interactionMode, setInteractionMode] = useState<"keyboard" | "pointer">("keyboard");
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
  const [fileIndexRevision, setFileIndexRevision] = useState(0);
  const indexedRootRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultListRef = useRef<HTMLDivElement>(null);
  const tabs = useWorkbenchStore((state) => state.tabs);
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
  const openFiles = useMemo(
    () => tabs.filter((tab) => tab.type === "file" && tab.path).map((tab) => tab.path as string),
    [tabs],
  );
  const results = useMemo(
    () =>
      buildFliunoResults({
        commands,
        files,
        scope: parsedQuery.scope,
        query: parsedQuery.query,
        recentCommands,
        recentFiles,
        openFiles,
        excludedCommandId: FLIUNO_COMMAND_ID,
      }),
    [commands, files, openFiles, parsedQuery, recentCommands, recentFiles],
  );

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
    void fileIndexRevision;
    if (!isOpen || !workspaceRoot || indexedRootRef.current === workspaceRoot) return;
    let active = true;
    setFileIndexState("loading");
    setFileIndexError(null);
    void WorkspaceSearchIPC.listFiles(workspaceRoot).then(
      (entries) => {
        if (!active) return;
        indexedRootRef.current = workspaceRoot;
        setFiles(entries);
        setFileIndexState("ready");
      },
      (error: unknown) => {
        if (!active) return;
        setFiles([]);
        setFileIndexState("error");
        setFileIndexError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      active = false;
    };
  }, [fileIndexRevision, isOpen, workspaceRoot]);

  useEffect(
    () =>
      EventBus.on("fs:changed", () => {
        indexedRootRef.current = null;
        setFileIndexRevision((revision) => revision + 1);
      }),
    [],
  );

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    if (!isOpen || interactionMode !== "keyboard") return;
    resultListRef.current
      ?.querySelector<HTMLElement>(`[data-fliuno-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [interactionMode, isOpen, selectedIndex]);

  if (!isOpen) return null;

  const close = () => setIsOpen(false);

  const execute = async (result: FliunoResult) => {
    if (result.kind === "file") {
      useWorkbenchStore.getState().openFile(result.file.path);
      const next = [
        result.file.path,
        ...recentFiles.filter((path) => path !== result.file.path),
      ].slice(0, 16);
      setRecentFiles(next);
      writeHistory(FLIUNO_RECENT_FILES_KEY, next);
      close();
      return;
    }
    if (!CommandRegistry.canExecute(result.command)) return;
    close();
    const execution = await CommandRegistry.execute(result.command.id);
    if (execution.ok) {
      const next = [
        result.command.id,
        ...recentCommands.filter((id) => id !== result.command.id),
      ].slice(0, 16);
      setRecentCommands(next);
      writeHistory(FLIUNO_RECENT_COMMANDS_KEY, next);
    } else if (execution.error) {
      EventBus.emit("app:toast", { type: "error", message: execution.error.message });
    }
  };

  const selectScope = (nextScope: FliunoScope) => {
    setScope(nextScope);
    setQuery((currentQuery) => {
      const trimmedQuery = currentQuery.trimStart();
      return trimmedQuery.startsWith(">") || trimmedQuery.startsWith("@")
        ? trimmedQuery.slice(1).trimStart()
        : currentQuery;
    });
    setSelectedIndex(0);
    setInteractionMode("keyboard");
    inputRef.current?.focus();
  };

  const moveSelection = (offset: number) => {
    if (!results.length) return;
    setInteractionMode("keyboard");
    setSelectedIndex((index) => Math.min(Math.max(index + offset, 0), results.length - 1));
  };

  const effectiveScopeLabel = scopeOptions.find((item) => item.id === parsedQuery.scope)?.label;
  const fileSearchUnavailable = parsedQuery.scope !== "commands" && !workspaceRoot;

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center px-5 pt-[9vh]">
      <button
        type="button"
        aria-label="关闭 Fliuno"
        className="absolute inset-0 bg-black/20 backdrop-blur-[5px]"
        onClick={close}
      />
      <section
        aria-label="Fliuno 全局搜索"
        className="relative flex max-h-[78vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[22px] border border-[var(--border-overlay)] bg-[var(--material-overlay)] shadow-[var(--shadow-overlay)] backdrop-blur-[var(--glass-blur-floating)]"
      >
        <div className="flex items-center gap-3 px-5 pb-3 pt-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--AccentPrimary)]/10 text-[var(--AccentPrimary)]">
            <Icons.Sparkles size={18} stroke={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--TextHighlight)]">Fliuno</span>
              <span className="text-[10px] text-[var(--TextMuted)]">快速抵达任何地方</span>
            </div>
            <div className="mt-0.5 truncate text-[9px] text-[var(--TextMuted)] opacity-70">
              使用 &gt; 搜索命令，使用 @ 搜索工作区文件
            </div>
          </div>
          <kbd className="rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 text-[9px] text-[var(--TextMuted)]">
            Esc
          </kbd>
        </div>

        <div className="mx-4 flex h-12 items-center gap-3 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--material-surface)] px-3.5 shadow-[var(--shadow-surface)] transition-[border-color,box-shadow] focus-within:border-[var(--TextMuted)]/30 focus-within:ring-2 focus-within:ring-[var(--TextMuted)]/10">
          <Icons.Search size={18} stroke={1.7} className="shrink-0 text-[var(--TextMuted)]" />
          <input
            ref={inputRef}
            data-aurona-input="embedded"
            role="combobox"
            aria-expanded="true"
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
              } else if (event.key === "PageDown") {
                event.preventDefault();
                moveSelection(7);
              } else if (event.key === "PageUp") {
                event.preventDefault();
                moveSelection(-7);
              } else if (event.key === "Home" && results.length) {
                event.preventDefault();
                setSelectedIndex(0);
              } else if (event.key === "End" && results.length) {
                event.preventDefault();
                setSelectedIndex(results.length - 1);
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
                void execute(results[selectedIndex]);
              }
            }}
            placeholder="搜索命令或文件…"
            className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[14px] text-[var(--TextHighlight)] outline-none ring-0 placeholder:text-[var(--TextMuted)] focus:outline-none focus-visible:outline-none focus-visible:ring-0"
          />
          {query && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => {
                setQuery("");
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
              className="rounded-lg p-1.5 text-[var(--TextMuted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--TextHighlight)]"
            >
              <Icons.Close size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 px-5 py-3">
          {scopeOptions.map((option) => {
            const active = parsedQuery.scope === option.id;
            const ScopeIcon = Icons[option.icon];
            return (
              <button
                type="button"
                key={option.id}
                onClick={() => selectScope(option.id)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-[background-color,color] ${
                  active
                    ? "bg-[var(--material-interactive-active)] text-[var(--TextHighlight)]"
                    : "text-[var(--TextMuted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--TextPrimary)]"
                }`}
              >
                <ScopeIcon size={12} stroke={1.8} />
                {option.label}
                {option.prefix && <span className="font-mono opacity-55">{option.prefix}</span>}
              </button>
            );
          })}
          <span className="ml-auto text-[9px] text-[var(--TextMuted)]">
            {fileIndexState === "loading" && parsedQuery.scope !== "commands"
              ? "正在整理工作区文件…"
              : `${results.length} 个${effectiveScopeLabel ?? ""}结果`}
          </span>
        </div>

        <div
          ref={resultListRef}
          id="fliuno-results"
          role="listbox"
          className="min-h-[190px] flex-1 overflow-y-auto border-t border-[var(--border-subtle)] px-2 py-2 aurona-scroll"
          onMouseLeave={() => setInteractionMode("keyboard")}
        >
          {results.length ? (
            results.map((result, index) => {
              const enabled = result.kind === "file" || CommandRegistry.canExecute(result.command);
              const selected = index === selectedIndex;
              const keybinding = formatKeybinding(result);
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
                  onClick={() => void execute(result)}
                  className={`group flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-[background-color,color] ${
                    selected
                      ? "bg-[var(--material-interactive-active)] text-[var(--TextHighlight)]"
                      : "text-[var(--TextPrimary)] hover:bg-[var(--material-interactive-hover)]"
                  } ${enabled ? "" : "cursor-not-allowed opacity-45"}`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      result.kind === "file"
                        ? "bg-[var(--AccentPrimary)]/9 text-[var(--AccentPrimary)]"
                        : "bg-[var(--material-panel)] text-[var(--TextMuted)]"
                    }`}
                  >
                    {result.kind === "file" ? (
                      <Icons.FileCode size={15} stroke={1.7} />
                    ) : (
                      <Icons.Command size={15} stroke={1.7} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{result.title}</span>
                      {result.recent && !parsedQuery.query && (
                        <span className="shrink-0 text-[8px] text-[var(--TextMuted)]">
                          最近使用
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--TextMuted)]">
                      {result.kind === "file" ? result.description : `命令 · ${result.description}`}
                    </span>
                  </span>
                  {!enabled && result.kind === "command" && (
                    <span className="max-w-44 truncate text-[9px] text-[var(--TextMuted)]">
                      {CommandRegistry.getDisabledReason(result.command) ?? "当前不可用"}
                    </span>
                  )}
                  {keybinding && (
                    <kbd className="rounded-md border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--TextMuted)]">
                      {keybinding}
                    </kbd>
                  )}
                  <Icons.ArrowRight
                    size={13}
                    className={`shrink-0 text-[var(--TextMuted)] transition-opacity ${selected ? "opacity-80" : "opacity-0"}`}
                  />
                </button>
              );
            })
          ) : (
            <div className="flex min-h-[210px] flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--material-surface)] text-[var(--TextMuted)]">
                {fileSearchUnavailable ? (
                  <Icons.FolderOpen size={20} />
                ) : (
                  <Icons.Search size={20} />
                )}
              </span>
              <div>
                <div className="text-[12px] font-medium text-[var(--TextPrimary)]">
                  {fileSearchUnavailable
                    ? "打开工作区后即可搜索文件"
                    : fileIndexState === "error"
                      ? "工作区文件暂时无法索引"
                      : parsedQuery.query
                        ? "没有找到匹配结果"
                        : "开始输入，Fliuno 会带你抵达目标"}
                </div>
                <div className="mt-1 max-w-[420px] text-[10px] text-[var(--TextMuted)]">
                  {fileIndexError ??
                    (parsedQuery.query
                      ? "尝试更短的关键词，或使用 > 和 @ 缩小范围"
                      : "命令、最近文件和工作区路径会在这里统一出现")}
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center gap-4 border-t border-[var(--border-subtle)] px-5 py-2.5 text-[9px] text-[var(--TextMuted)]">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Tab 切换范围</span>
          <span className="ml-auto">Fliuno · Aurona Code</span>
        </footer>
      </section>
    </div>
  );
}
