import { useEffect, useMemo, useRef, useState } from "react";
import { type CommandDefinition, CommandRegistry } from "../../Extension/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";
import { Icons } from "../Icons/IconManager";

const label = (command: CommandDefinition<unknown>) => `${command.category}: ${command.title}`;

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = isOpen ? CommandRegistry.getCommands() : [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.category} ${command.title} ${command.id}`
        .toLocaleLowerCase("zh-CN")
        .includes(needle),
    );
  }, [commands, query]);

  useEffect(
    () =>
      EventBus.on("app:show-command-palette", () => {
        setQuery("");
        setSelectedIndex(0);
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
    setIsOpen(false);
    const result = await CommandRegistry.execute(command.id);
    if (!result.ok && result.error) {
      EventBus.emit("app:toast", { type: "error", message: result.error.message });
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="关闭命令面板"
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
        onClick={() => setIsOpen(false)}
      />
      <section
        aria-label="命令面板"
        className="relative w-full max-w-[620px] overflow-hidden rounded-[var(--radius-overlay)] border border-[var(--border-overlay)] bg-[var(--material-overlay)] shadow-[var(--shadow-overlay)]"
      >
        <div className="flex h-12 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
          <Icons.Search size={17} className="text-[var(--TextMuted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setIsOpen(false);
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter" && filtered[selectedIndex]) {
                event.preventDefault();
                void execute(filtered[selectedIndex]);
              }
            }}
            placeholder="输入命令名称"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[var(--TextPrimary)] placeholder:text-[var(--TextMuted)] focus-visible:outline-none"
          />
          <kbd className="rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--TextMuted)]">
            Esc
          </kbd>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-1.5" role="listbox">
          {filtered.length ? (
            filtered.map((command, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                key={command.id}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => void execute(command)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[12px] ${
                  index === selectedIndex
                    ? "bg-[var(--material-interactive-active)] text-[var(--TextHighlight)]"
                    : "text-[var(--TextPrimary)] hover:bg-[var(--material-interactive-hover)]"
                }`}
              >
                <span className="truncate">{label(command)}</span>
                <span className="ml-auto truncate font-mono text-[10px] text-[var(--TextMuted)]">
                  {command.id}
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-8 text-center text-[12px] text-[var(--TextMuted)]">
              没有匹配的命令
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
