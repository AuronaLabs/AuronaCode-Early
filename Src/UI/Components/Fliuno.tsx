import { useEffect, useMemo, useRef, useState } from "react";
import { type CommandDefinition, CommandRegistry } from "../../Extension/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";
import { Icons } from "../Icons/IconManager";

const FLIUNO_RECENT_KEY = "aurona.fliuno.recent.v1";
const LEGACY_RECENT_KEY = "aurona.commandPalette.recent.v1";
const FLIUNO_COMMAND_ID = "workbench.action.openFliuno";

const fuzzyScore = (value: string, query: string): number => {
  if (!query) return 0;
  const haystack = value.toLocaleLowerCase("zh-CN");
  const needle = query.toLocaleLowerCase("zh-CN");
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return 200 - direct;
  let cursor = -1;
  let gaps = 0;
  for (const character of needle) {
    const next = haystack.indexOf(character, cursor + 1);
    if (next < 0) return -1;
    if (cursor >= 0) gaps += next - cursor - 1;
    cursor = next;
  }
  return 100 - gaps;
};

const formatKeybinding = (command: CommandDefinition<unknown>) => {
  const binding = command.keybindings?.[0];
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

const loadRecentCommands = (): string[] => {
  try {
    const stored =
      localStorage.getItem(FLIUNO_RECENT_KEY) ?? localStorage.getItem(LEGACY_RECENT_KEY) ?? "[]";
    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
};

export function Fliuno() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [interactionMode, setInteractionMode] = useState<"keyboard" | "pointer" | null>(null);
  const [recent, setRecent] = useState<string[]>(loadRecentCommands);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = isOpen
    ? CommandRegistry.getCommands().filter((command) => command.id !== FLIUNO_COMMAND_ID)
    : [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return commands
      .map((command) => ({
        command,
        score: needle
          ? fuzzyScore(`${command.title} ${command.category} ${command.id}`, needle)
          : 0,
        recentIndex: recent.indexOf(command.id),
      }))
      .filter(({ score }) => score >= 0)
      .sort((left, right) => {
        if (needle && right.score !== left.score) return right.score - left.score;
        const leftRecent = left.recentIndex < 0 ? Number.MAX_SAFE_INTEGER : left.recentIndex;
        const rightRecent = right.recentIndex < 0 ? Number.MAX_SAFE_INTEGER : right.recentIndex;
        return leftRecent - rightRecent;
      })
      .map(({ command }) => command);
  }, [commands, query, recent]);

  useEffect(
    () =>
      EventBus.on("app:show-fliuno", () => {
        setQuery("");
        setSelectedIndex(0);
        setHoveredIndex(null);
        setInteractionMode(null);
        setIsOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }),
    [],
  );

  useEffect(() => {
    if (selectedIndex >= filtered.length) setSelectedIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, selectedIndex]);

  if (!isOpen) return null;

  const execute = async (command: CommandDefinition<unknown>) => {
    if (!CommandRegistry.canExecute(command)) return;
    setIsOpen(false);
    const result = await CommandRegistry.execute(command.id);
    if (result.ok) {
      const next = [command.id, ...recent.filter((id) => id !== command.id)].slice(0, 12);
      setRecent(next);
      try {
        localStorage.setItem(FLIUNO_RECENT_KEY, JSON.stringify(next));
      } catch {
        // Fliuno history is a non-critical local enhancement.
      }
    }
    if (!result.ok && result.error) {
      EventBus.emit("app:toast", { type: "error", message: result.error.message });
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center px-4 pt-[10vh]">
      <button
        type="button"
        aria-label="关闭 Fliuno"
        className="absolute inset-0 bg-black/15 backdrop-blur-[3px]"
        onClick={() => setIsOpen(false)}
      />
      <section
        aria-label="Fliuno 全局搜索"
        className="relative w-full max-w-[720px] overflow-hidden rounded-[20px] border border-[var(--border-overlay)] bg-[var(--material-overlay)] shadow-[var(--shadow-overlay)] backdrop-blur-[var(--glass-blur-floating)]"
      >
        <div className="mx-4 mt-4 flex h-12 items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--material-surface)] px-3.5 shadow-[var(--shadow-surface)] transition-[border-color,box-shadow] focus-within:border-[var(--TextMuted)]/30 focus-within:ring-2 focus-within:ring-[var(--TextMuted)]/10">
          <Icons.Search size={18} stroke={1.7} className="shrink-0 text-[var(--TextMuted)]" />
          <input
            ref={inputRef}
            data-aurona-input="embedded"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
              setHoveredIndex(null);
              setInteractionMode(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setIsOpen(false);
              else if (event.key === "ArrowDown" && filtered.length > 0) {
                event.preventDefault();
                setInteractionMode("keyboard");
                setHoveredIndex(null);
                setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp" && filtered.length > 0) {
                event.preventDefault();
                setInteractionMode("keyboard");
                setHoveredIndex(null);
                setSelectedIndex((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter" && filtered[selectedIndex]) {
                event.preventDefault();
                void execute(filtered[selectedIndex]);
              }
            }}
            placeholder="在 Fliuno 的世界里遨游"
            className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[14px] text-[var(--TextHighlight)] outline-none ring-0 placeholder:text-[var(--TextMuted)] focus:outline-none focus-visible:outline-none focus-visible:ring-0"
          />
          <kbd className="rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 text-[9px] text-[var(--TextMuted)]">
            Esc
          </kbd>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 text-[10px] text-[var(--TextMuted)]">
          <span>搜索范围</span>
          <span className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--material-surface)] px-2 py-1 font-medium text-[var(--TextHighlight)] shadow-[var(--shadow-surface)]">
            <Icons.Command size={12} stroke={1.8} />
            命令
          </span>
          <span className="opacity-70">当前已接入</span>
          <span className="ml-auto tabular-nums">{filtered.length} 个结果</span>
        </div>

        <div
          className="max-h-[400px] min-h-[160px] overflow-y-auto border-t border-[var(--border-subtle)] p-2"
          role="listbox"
          onMouseLeave={() => {
            setHoveredIndex(null);
            setInteractionMode(null);
          }}
        >
          {filtered.length ? (
            filtered.map((command, index) => {
              const enabled = CommandRegistry.canExecute(command);
              const selected =
                (interactionMode === "keyboard" && index === selectedIndex) ||
                (interactionMode === "pointer" && index === hoveredIndex);
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  key={command.id}
                  onMouseEnter={() => {
                    setHoveredIndex(index);
                    setSelectedIndex(index);
                    setInteractionMode("pointer");
                  }}
                  onClick={() => void execute(command)}
                  disabled={!enabled}
                  className={`group flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-[background-color,border-color,box-shadow,color] ${
                    selected
                      ? "border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--TextHighlight)] shadow-[var(--shadow-surface)]"
                      : "border-transparent text-[var(--TextPrimary)] hover:bg-[var(--material-interactive-hover)]"
                  } ${enabled ? "" : "cursor-not-allowed opacity-45"}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--material-panel)] text-[var(--TextMuted)]">
                    <Icons.Command size={15} stroke={1.7} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{command.title}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--TextMuted)]">
                      命令 · {command.category}
                    </span>
                  </span>
                  {!enabled && (
                    <span className="text-[9px] text-[var(--TextMuted)]">当前不可用</span>
                  )}
                  {formatKeybinding(command) && (
                    <kbd className="rounded-md border border-[var(--border-subtle)] bg-[var(--material-panel)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--TextMuted)]">
                      {formatKeybinding(command)}
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
            <div className="flex min-h-[170px] flex-col items-center justify-center gap-3 px-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--material-surface)] text-[var(--TextMuted)]">
                <Icons.Search size={18} />
              </div>
              <div>
                <div className="text-[12px] font-medium text-[var(--TextPrimary)]">
                  Fliuno 没有找到相关内容
                </div>
                <div className="mt-1 text-[10px] text-[var(--TextMuted)]">
                  尝试更短的关键词或命令分类
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center gap-4 border-t border-[var(--border-subtle)] px-5 py-2 text-[9px] text-[var(--TextMuted)]">
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
          <span className="ml-auto">Fliuno · Aurona Code</span>
        </footer>
      </section>
    </div>
  );
}
