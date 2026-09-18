import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type FliunoCoreResult, parseFliunoQuery } from "../../Core/Fliuno/FliunoCore";
import {
  flattenFliunoPresentation,
  SECTION_LABEL_KEYS,
  SECTION_ORDER,
} from "../../Core/Fliuno/presentation";
import { CommandRegistry } from "../../Extension/CommandRegistry";
import { EventBus } from "../../Foundation/EventBus";
import { useLocale } from "../../Foundation/I18n";
import { EmptyState } from "../../UI/Components/EmptyState";
import { Icons } from "../../UI/Icons/IconManager";
import { FliunoGroupHeader, ModalResultRow } from "./components/FliunoResultGroups";
import { FliunoScopeRow } from "./components/FliunoScopeRow";
import { FliunoSearchRow } from "./components/FliunoSearchRow";
import { useFliunoActiveScroll, useFliunoKeyboard } from "./components/useFliunoKeyboard";
import { executeFliunoResult, useFliunoSearch } from "./components/useFliunoSearch";

const FLIUNO_COMMAND_ID = "workbench.action.openFliuno";

export function FliunoModal() {
  const { t } = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultListRef = useRef<HTMLDivElement>(null);

  const search = useFliunoSearch({ enabled: isOpen, excludedCommandId: FLIUNO_COMMAND_ID });
  const {
    query,
    setQuery,
    results,
    setResults,
    selectedIndex,
    setSelectedIndex,
    contentCaseSensitive,
    toggleCaseSensitive,
    contentRegex,
    toggleRegex,
    fileIndexState,
    fileIndexError,
    pushRecentCommand,
    pushRecentFile,
    selectScope,
    cancel,
  } = search;

  const registryRevision = useSyncExternalStore(
    (listener) => CommandRegistry.subscribe(listener),
    () => CommandRegistry.getRevision(),
    () => 0,
  );

  const commands = useMemo(() => {
    void registryRevision;
    return isOpen ? CommandRegistry.getCommands() : [];
  }, [isOpen, registryRevision]);

  const parsedQuery = useMemo(() => parseFliunoQuery(query, search.scope), [query, search.scope]);

  // 展示顺序 = 键盘导航顺序 = Enter 执行顺序（与工作区页同一 presentation 模型）
  const presentation = useMemo(() => flattenFliunoPresentation(results), [results]);

  const commandByResult = useMemo(() => {
    const map = new Map<string, (typeof commands)[number]>();
    for (const command of commands) map.set(command.id, command);
    return map;
  }, [commands]);

  // 分组渲染（组头 sticky）：displayIndex 为拍平后的可视索引
  const kindGroups = useMemo(
    () =>
      SECTION_ORDER.map((kind) => ({
        kind,
        items: presentation.display.filter((result) => result.kind === kind),
      })).filter((group) => group.items.length > 0),
    [presentation.display],
  );

  useEffect(
    () =>
      EventBus.on("app:show-fliuno", () => {
        setQuery("");
        search.setScope("all");
        setSelectedIndex(-1);
        setIsOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }),
    [search.setScope, setQuery, setSelectedIndex],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLocaleLowerCase("en-US") === "p") {
        event.preventDefault();
        setQuery("");
        search.setScope("all");
        setSelectedIndex(-1);
        setIsOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [search.setScope, setQuery, setSelectedIndex]);

  const close = () => {
    cancel();
    setIsOpen(false);
    setResults([]);
    setQuery("");
  };

  const execute = (result: FliunoCoreResult) => {
    executeFliunoResult(result, { command: pushRecentCommand, file: pushRecentFile });
    close();
  };

  const executeSelected = () => {
    const selected = presentation.display[selectedIndex];
    if (selected) execute(selected);
  };

  const handleKeyDown = useFliunoKeyboard({
    itemCount: presentation.display.length,
    scope: search.scope,
    pageSize: 10,
    setSelectedIndex,
    onScopeSelect: selectScope,
    onExecuteSelected: executeSelected,
    onEscape: close,
  });

  useFliunoActiveScroll(resultListRef, selectedIndex);

  if (!isOpen) return null;

  const hasQuery = query.trim().length > 0;
  const activeResult = presentation.display[selectedIndex];

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center px-5 pt-[9vh]">
      <button
        type="button"
        aria-label={t("fliuno.closeLabel")}
        className="absolute inset-0 bg-black/20 backdrop-blur-[5px]"
        onClick={close}
      />
      <section
        data-testid="fliuno-surface"
        aria-label={t("fliuno.surfaceLabel")}
        className={`glass-layer-overlay relative grid w-full max-w-[720px] overflow-hidden border border-[var(--border-overlay)] bg-[var(--material-panel)] backdrop-blur-[var(--glass-blur-overlay)] transition-[border-color,border-radius,box-shadow] duration-200 focus-within:border-[var(--color-text-muted)]/25 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-text-muted)_14%,transparent)] ${
          hasQuery ? "rounded-[20px]" : "rounded-[18px]"
        }`}
      >
        <FliunoSearchRow
          variant="modal"
          query={query}
          inputRef={inputRef}
          combobox={{
            expanded: hasQuery,
            controlsId: "fliuno-results",
            activeDescendant: activeResult?.id,
          }}
          onQueryChange={(value) => {
            setQuery(value);
            setSelectedIndex(-1);
          }}
          onClear={() => {
            setQuery("");
            setSelectedIndex(-1);
            inputRef.current?.focus();
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("fliuno.quickPlaceholder")}
        />

        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
            hasQuery
              ? "grid-rows-[1fr] opacity-100"
              : "pointer-events-none grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="border-t border-[var(--border-subtle)] px-4 py-2.5">
              <FliunoScopeRow
                size="md"
                scope={parsedQuery.scope}
                onScopeChange={selectScope}
                caseSensitive={contentCaseSensitive}
                onToggleCaseSensitive={toggleCaseSensitive}
                regex={contentRegex}
                onToggleRegex={toggleRegex}
                count={results.length}
                indexing={fileIndexState === "loading" && parsedQuery.scope !== "commands"}
              />
            </div>

            <div
              ref={resultListRef}
              id="fliuno-results"
              role="listbox"
              className="max-h-[56vh] min-h-[190px] overflow-y-auto border-t border-[var(--border-subtle)] px-2 py-2 aurona-scroll"
            >
              {kindGroups.length ? (
                <div className="flex flex-col gap-2">
                  {kindGroups.map((group) => (
                    <div key={group.kind} className="flex flex-col gap-0.5">
                      <FliunoGroupHeader className="bg-[var(--material-panel)] px-3 py-1.5">
                        {t(SECTION_LABEL_KEYS[group.kind])}
                      </FliunoGroupHeader>
                      {group.items.map((result) => {
                        const displayIndex = presentation.indexById.get(result.id) ?? 0;
                        const command =
                          result.kind === "command"
                            ? commandByResult.get(result.commandId ?? "")
                            : undefined;
                        const enabled =
                          result.kind === "file" ||
                          result.kind !== "command" ||
                          (command ? CommandRegistry.canExecute(command) : false);
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
                          <ModalResultRow
                            key={result.id}
                            result={result}
                            index={displayIndex}
                            selected={displayIndex === selectedIndex}
                            enabled={enabled}
                            keybinding={keybinding}
                            disabledReason={
                              command
                                ? (CommandRegistry.getDisabledReason(command) ??
                                  t("fliuno.commandUnavailable"))
                                : undefined
                            }
                            showRecentHint={Boolean(result.recent) && !query}
                            recentLabel={t("common.recent")}
                            onSelect={() => setSelectedIndex(displayIndex)}
                            onExecute={execute}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  className="min-h-[210px]"
                  icon={<Icons.Search size={24} stroke={1.5} />}
                  title={
                    !search.workspaceRoot && parsedQuery.scope !== "commands"
                      ? t("fliuno.noWorkspace")
                      : fileIndexState === "error"
                        ? (fileIndexError ?? t("common.noResults"))
                        : parsedQuery.query
                          ? t("common.noResults")
                          : t("fliuno.emptyHint")
                  }
                  description={parsedQuery.query ? t("common.tryShorter") : undefined}
                />
              )}
            </div>

            <footer className="flex items-center gap-4 border-t border-[var(--border-subtle)] px-5 py-2 text-[9px] text-[var(--color-text-muted)]/75">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-[var(--border-subtle)] px-1 py-0.5">↑↓</kbd>
                {t("common.search")}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-[var(--border-subtle)] px-1 py-0.5">
                  Enter
                </kbd>
                {t("common.open")}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-[var(--border-subtle)] px-1 py-0.5">Esc</kbd>
                {t("common.cancel")}
              </span>
              <span className="ml-auto flex items-center gap-2 opacity-80">
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
                  {"!"} {t("extensions.sidebarTitle")}
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
